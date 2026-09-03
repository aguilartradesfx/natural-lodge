import { requireUser } from '@/lib/api-auth';
import { mapProspect } from '@/lib/prospect-mapper';
import { importProspects } from '@/lib/prospect-importer';
import type { RawProspect } from '@/lib/prospect-types';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const WORKFLOW = 'importador_contactos';

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: { batchTag?: string; rows?: RawProspect[]; mode?: 'normal' | 'forceUpdate' } | null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: 'No hay filas para reintentar' }, { status: 400 });
  }
  if (rows.length > 500) {
    return Response.json({ error: 'Demasiadas filas (máx 500)' }, { status: 400 });
  }

  const batchTag = typeof body?.batchTag === 'string' ? body.batchTag : '';
  let mapped;
  try {
    mapped = rows.map((r) => mapProspect(r, batchTag));
  } catch {
    return Response.json({ error: 'Filas inválidas' }, { status: 400 });
  }
  // Mismo motivo que en la ruta de importación: si esto revienta, el motivo real
  // tiene que sobrevivir a la ventana rodante de logs de Vercel.
  try {
    const report = await importProspects(mapped, {
      onDuplicate: body?.mode === 'forceUpdate' ? 'update' : 'report',
    });
    return Response.json({ ok: true, report, batchTag });
  } catch (err) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'reintento',
      error: err,
      context: { filas: rows.length, batchTag, mode: body?.mode ?? 'normal' },
    });
    const detalle = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `No se pudo reintentar: ${detalle}` }, { status: 500 });
  }
}
