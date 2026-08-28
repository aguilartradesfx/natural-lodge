import 'server-only';
import {
  searchContacts, createContact, updateContact, createNote, createOpportunity,
  getPipelines, getCustomFields, addContactTags, type GhlContact,
} from '@/lib/ghl';
import { DEFAULT_PIPELINE, DEFAULT_STAGE } from '@/lib/prospect-parser';
import { contactFingerprint, type MappedProspect } from '@/lib/prospect-mapper';
import type { RawProspect } from '@/lib/prospect-types';

export type FailedRow = {
  rowNumber: number;
  name: string;
  reason: string;
  hint: string;
  matchingField?: 'phone' | 'email';
  raw: RawProspect;
};

export type DuplicateRow = {
  rowNumber: number;
  name: string;
  company: string;
  matchedBy: 'email' | 'phone' | 'fingerprint';
  existingId: string;
  incoming: Record<string, string>;
  existing: Record<string, string>;
  differingFields: string[];
  raw: RawProspect;
};

export type ImportOptions = {
  /** Agrega `secuencia-prospeccion` a las filas nuevas con correo. */
  startSequence?: boolean;
  /** 'report' (default) no escribe nada; 'update' actualiza y marca para revisión. */
  onDuplicate?: 'report' | 'update';
};

export type ImportReport = {
  created: number;
  updated: number;
  failed: FailedRow[];
  duplicates: DuplicateRow[];
  missingCustomFields: string[];
  pipelineResolved: boolean;
};

/** Traduce el error crudo de GHL a una pista accionable en español. */
export function explainGhlError(reason: string): { hint: string; matchingField?: 'phone' | 'email' } {
  let parsed: { message?: string; meta?: { matchingField?: string } } | null = null;
  const brace = reason.indexOf('{');
  if (brace >= 0) {
    try {
      parsed = JSON.parse(reason.slice(brace));
    } catch {
      parsed = null;
    }
  }
  const message = (parsed?.message || reason).toLowerCase();
  const matchingField = parsed?.meta?.matchingField;
  if (message.includes('duplicated')) {
    if (matchingField === 'email') {
      return { hint: 'Ya existe un contacto con ese correo.', matchingField: 'email' };
    }
    return {
      hint: 'Ya existe un contacto con ese teléfono (línea de agencia compartida). Quita el teléfono o pon uno propio.',
      matchingField: 'phone',
    };
  }
  if (message.includes('too long') && message.includes('phone')) {
    return { hint: 'El teléfono no es válido. Corrígelo o quítalo.' };
  }
  return { hint: reason };
}

/** Busca un contacto ya existente para evitar duplicados. */
export async function findExisting(m: MappedProspect): Promise<GhlContact | null> {
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
    const sameFingerprint =
      contactFingerprint(candidate.firstName || '', candidate.lastName || '', candidate.companyName || '') ===
      m.fingerprint;
    const candidateHasNoName = !(candidate.firstName || candidate.lastName);
    return sameFingerprint || candidateHasNoName ? candidate : null;
  }
  return (
    results.find(
      (c) => contactFingerprint(c.firstName || '', c.lastName || '', c.companyName || '') === m.fingerprint,
    ) || null
  );
}

const COMPARABLE = ['firstName', 'lastName', 'companyName', 'email', 'phone'] as const;
const digits = (s: string) => s.replace(/\D/g, '').slice(-10);

/** Arma la fila de revisión comparando el archivo contra lo que hay en GHL. */
export function buildDuplicateRow(m: MappedProspect, existing: GhlContact): DuplicateRow {
  const incoming: Record<string, string> = {};
  const current: Record<string, string> = {};
  const differingFields: string[] = [];

  for (const f of COMPARABLE) {
    const a = (m.contact[f] || '').trim();
    const b = (existing[f] || '').trim();
    incoming[f] = a;
    current[f] = b;
    // El teléfono se compara por dígitos: `cleanPhone()` reescribe el número
    // entrante a formato +1XXXXXXXXXX, que casi nunca es como GHL lo tiene
    // guardado, así que la comparación textual lo marcaría como "distinto"
    // aunque sea el mismo número.
    const differs = f === 'phone' ? digits(a) !== digits(b) : a.toLowerCase() !== b.toLowerCase();
    if (a && differs) differingFields.push(f);
  }

  const sameEmail =
    Boolean(m.contact.email) &&
    (existing.email || '').toLowerCase() === m.contact.email.toLowerCase();
  const samePhone =
    Boolean(m.contact.phone) && digits(existing.phone || '') === digits(m.contact.phone);

  return {
    rowNumber: m.raw.rowNumber,
    name: m.contact.name,
    company: m.contact.companyName,
    matchedBy: sameEmail ? 'email' : samePhone ? 'phone' : 'fingerprint',
    existingId: existing.id,
    incoming,
    existing: current,
    differingFields,
    raw: m.raw,
  };
}

/** Motor de importación: crea/actualiza cada prospecto en GHL y arma el reporte. */
export async function importProspects(
  mapped: MappedProspect[],
  options: ImportOptions = {},
): Promise<ImportReport> {
  const onDuplicate = options.onDuplicate ?? 'report';
  const report: ImportReport = {
    created: 0,
    updated: 0,
    failed: [],
    duplicates: [],
    missingCustomFields: [],
    pipelineResolved: false,
  };
  if (!mapped.length) return report;

  const cfByName = new Map<string, string>();
  try {
    for (const f of await getCustomFields()) cfByName.set(f.name.trim().toLowerCase(), f.id);
  } catch {
    /* sin custom fields */
  }

  let pipelineId = '';
  let stageId = '';
  try {
    const wantPipe = (mapped[0].raw.pipeline || DEFAULT_PIPELINE).trim().toLowerCase();
    const wantStage = (mapped[0].raw.stage || DEFAULT_STAGE).trim().toLowerCase();
    const pipe = (await getPipelines()).find((p) => p.name.trim().toLowerCase() === wantPipe);
    if (pipe) {
      pipelineId = pipe.id;
      const stage = pipe.stages.find((s) => s.name.trim().toLowerCase() === wantStage) || pipe.stages[0];
      stageId = stage?.id || '';
      report.pipelineResolved = Boolean(pipelineId && stageId);
    }
  } catch {
    /* sin pipeline */
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
      if (existing && onDuplicate === 'report') {
        report.duplicates.push(buildDuplicateRow(m, existing));
        continue;
      }

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
      const reason = (e as Error).message;
      const { hint, matchingField } = explainGhlError(reason);
      report.failed.push({
        rowNumber: m.raw.rowNumber,
        name: m.contact.name,
        reason,
        hint,
        matchingField,
        raw: m.raw,
      });
    }
  }

  report.missingCustomFields = [...missing];
  return report;
}
