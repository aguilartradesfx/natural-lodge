import { scanAndSummarize } from '@/lib/review-scan';
import { requireUser } from '@/lib/api-auth';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_resumenes';

/**
 * Mismo motor que el cron, disparado a mano desde la bandeja. Existe porque
 * el plan Hobby de Vercel solo permite crons diarios: sin este botón, el
 * equipo tendría que esperar al reloj para ver conversaciones nuevas.
 */
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const resultado = await scanAndSummarize();
    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'refresh_manual', error: err });
    return Response.json({ error: 'No se pudo actualizar la bandeja' }, { status: 500 });
  }
}
