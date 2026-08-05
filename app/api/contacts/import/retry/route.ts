import { requireUser } from '@/lib/api-auth';
import { mapProspect } from '@/lib/prospect-mapper';
import { importProspects } from '@/lib/prospect-importer';
import type { RawProspect } from '@/lib/prospect-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: { batchTag?: string; rows?: RawProspect[] } | null;
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
  const report = await importProspects(mapped);
  return Response.json({ ok: true, report, batchTag });
}
