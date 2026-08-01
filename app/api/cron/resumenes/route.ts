import { scanAndSummarize } from '@/lib/review-scan';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_resumenes';

export async function GET(req: Request) {
  // Seguridad del cron (Vercel envía Authorization: Bearer $CRON_SECRET).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }
  }

  try {
    const resultado = await scanAndSummarize();
    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'cron', error: err });
    return Response.json({ error: 'Error en el barrido de resúmenes' }, { status: 500 });
  }
}
