import { requireUser } from '@/lib/api-auth';
import { parseProspectFile, DEFAULT_SOURCE } from '@/lib/prospect-parser';
import { validateProspects } from '@/lib/prospect-validator';
import { mapProspect, deriveBatchTag } from '@/lib/prospect-mapper';
import { summarizeBatch } from '@/lib/prospect-summary';
import { importProspects } from '@/lib/prospect-importer';

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
  const startSequence = form.get('startSequence') === '1';

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
    return Response.json({ ok: true, format, metrics, summary, preview, batchTag });
  }

  const report = await importProspects(mapped, { startSequence });
  return Response.json({ ok: true, report, batchTag });
}
