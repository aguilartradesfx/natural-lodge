import { requireUser } from '@/lib/api-auth';
import { getReviewDetail } from '@/lib/reviews';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: 'Id de revisión inválido' }, { status: 400 });
  }

  try {
    const detalle = await getReviewDetail(reviewId);
    if (!detalle) return Response.json({ error: 'La revisión no existe' }, { status: 404 });
    return Response.json(detalle);
  } catch (err) {
    await logWorkflowError({
      workflow: 'revision_feedback',
      node: 'detalle',
      error: err,
      context: { reviewId },
    });
    return Response.json({ error: 'No se pudo cargar la conversación' }, { status: 500 });
  }
}
