import { requireUser } from '@/lib/api-auth';
import { parseProspectFile, DEFAULT_PIPELINE, DEFAULT_STAGE, DEFAULT_SOURCE } from '@/lib/prospect-parser';
import { validateProspects } from '@/lib/prospect-validator';
import { mapProspect, deriveBatchTag, contactFingerprint, type MappedProspect } from '@/lib/prospect-mapper';
import { summarizeBatch } from '@/lib/prospect-summary';
import {
  searchContacts, createContact, updateContact, createNote, createOpportunity,
  getPipelines, getCustomFields, addContactTags, type GhlContact,
} from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Se esperaba multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Falta el archivo' }, { status: 400 });
  }

  const dryRun =
    new URL(req.url).searchParams.get('dryRun') === '1' || form.get('dryRun') === '1';

  let parsed;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    parsed = parseProspectFile(buf, file.name);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }

  const { prospects, format } = parsed;
  if (!prospects.length) {
    return Response.json({ error: 'El archivo no tiene filas' }, { status: 422 });
  }

  const { validations, metrics } = validateProspects(prospects);
  const batchSeed =
    prospects[0].source && prospects[0].source !== DEFAULT_SOURCE ? prospects[0].source : file.name;
  const batchTag = deriveBatchTag(batchSeed);
  const mapped = prospects.map((p) => mapProspect(p, batchTag));

  if (dryRun) {
    const sampleWarnings = validations.flatMap((v) => v.warnings).slice(0, 10);
    const summary = await summarizeBatch({ metrics, sampleWarnings });
    const preview = mapped.map((m, i) => ({
      rowNumber: m.raw.rowNumber,
      name: m.contact.name,
      company: m.contact.companyName,
      email: m.contact.email,
      phone: m.contact.phone,
      tags: m.tags,
      hasContactChannel: m.hasContactChannel,
      warnings: validations[i].warnings,
    }));
    return Response.json({ ok: true, format, metrics, summary, preview });
  }

  // ── Ejecución real ──
  const report = {
    created: 0,
    updated: 0,
    failed: [] as Array<{ rowNumber: number; name: string; reason: string }>,
    missingCustomFields: [] as string[],
    pipelineResolved: false,
  };

  // Resolver IDs una sola vez (con degradación elegante).
  const cfByName = new Map<string, string>();
  try {
    for (const f of await getCustomFields()) cfByName.set(f.name.trim().toLowerCase(), f.id);
  } catch {
    /* sin custom fields: se reportan como faltantes abajo */
  }

  let pipelineId = '';
  let stageId = '';
  try {
    const wantPipe = (prospects[0].pipeline || DEFAULT_PIPELINE).trim().toLowerCase();
    const wantStage = (prospects[0].stage || DEFAULT_STAGE).trim().toLowerCase();
    const pipe = (await getPipelines()).find((p) => p.name.trim().toLowerCase() === wantPipe);
    if (pipe) {
      pipelineId = pipe.id;
      const stage = pipe.stages.find((s) => s.name.trim().toLowerCase() === wantStage) || pipe.stages[0];
      stageId = stage?.id || '';
      report.pipelineResolved = Boolean(pipelineId && stageId);
    }
  } catch {
    /* sin pipeline: no se crean oportunidades */
  }

  const missing = new Set<string>();

  for (const m of mapped) {
    try {
      const resolvedCF = m.customFields
        .map((f) => {
          const id = cfByName.get(f.name.trim().toLowerCase());
          if (!id) {
            missing.add(f.name);
            return null;
          }
          return { id, field_value: f.value };
        })
        .filter((x): x is { id: string; field_value: string } => x !== null);

      const fields = { ...m.contact, customFields: resolvedCF };

      const existing = await findExisting(m);
      let contactId: string;
      let outcome: 'created' | 'updated';
      if (existing) {
        const c = await updateContact(existing.id, fields);
        contactId = c.id;
        outcome = 'updated';
      } else {
        const c = await createContact(fields);
        contactId = c.id;
        outcome = 'created';
      }

      if (m.tags.length) await addContactTags(contactId, m.tags);
      if (outcome === 'created') {
        if (m.note) await createNote(contactId, m.note);
        if (report.pipelineResolved) {
          await createOpportunity({ pipelineId, stageId, name: m.opportunityName, contactId });
        }
      }

      if (outcome === 'created') report.created++;
      else report.updated++;
    } catch (e) {
      report.failed.push({
        rowNumber: m.raw.rowNumber,
        name: m.contact.name,
        reason: (e as Error).message,
      });
    }
  }

  report.missingCustomFields = [...missing];
  return Response.json({ ok: true, report });
}

/** Busca un contacto ya existente para evitar duplicados. */
async function findExisting(m: MappedProspect): Promise<GhlContact | null> {
  const query =
    m.contact.email || m.contact.phone || `${m.contact.firstName} ${m.contact.lastName}`.trim();
  if (!query) return null;

  const results = await searchContacts({ query });
  if (!results.length) return null;

  if (m.contact.email) {
    const e = m.contact.email.toLowerCase();
    return results.find((c) => (c.email || '').toLowerCase() === e) || null;
  }
  if (m.contact.phone) {
    const norm = (s: string) => s.replace(/\D/g, '').slice(-10);
    const target = norm(m.contact.phone);
    const candidate = results.find(
      (c) => norm(c.phone || '') !== '' && norm(c.phone || '') === target,
    );
    if (!candidate) return null;
    // Varios asesores comparten el teléfono general de la agencia. No sobrescribas
    // a una persona DISTINTA que comparte el número: solo tratamos como "el mismo"
    // si la huella nombre+empresa coincide, o si el contacto existente no tiene
    // nombre (un stub previo que estamos completando).
    const sameFingerprint =
      contactFingerprint(candidate.firstName || '', candidate.lastName || '', candidate.companyName || '') ===
      m.fingerprint;
    const candidateHasNoName = !(candidate.firstName || candidate.lastName);
    return sameFingerprint || candidateHasNoName ? candidate : null;
  }
  // Sin canal: huella nombre+empresa.
  return (
    results.find(
      (c) => contactFingerprint(c.firstName || '', c.lastName || '', c.companyName || '') === m.fingerprint,
    ) || null
  );
}
