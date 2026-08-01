import { requireUser } from '@/lib/api-auth';
import { generateRuleForReview } from '@/lib/reviews';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_feedback';

/**
 * Reintenta solo la generación de la regla, sin volver a pedirle nada a la
 * persona: su calificación y comentario ya están guardados.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: 'Id de revisión inválido' }, { status: 400 });
  }

  try {
    const rule = await generateRuleForReview(reviewId, auth.user?.email || 'desconocido');
    return Response.json({ ok: true, rule });
  } catch (err) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'reintentar_regla',
      error: err,
      context: { reviewId },
    });
    return Response.json({ error: 'No se pudo generar la regla' }, { status: 500 });
  }
}
