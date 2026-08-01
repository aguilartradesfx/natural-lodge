import { requireUser } from '@/lib/api-auth';
import { saveFeedback, generateRuleForReview, type AnchorInput } from '@/lib/reviews';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_feedback';
const RATINGS = ['bien', 'regular', 'mal'] as const;
type Rating = (typeof RATINGS)[number];

type Body = {
  rating?: string;
  comment?: string;
  anchors?: unknown;
};

/** Descarta anclajes malformados en vez de rechazar todo el envío. */
function normalizarAnclajes(valor: unknown): AnchorInput[] {
  if (!Array.isArray(valor)) return [];
  const salida: AnchorInput[] = [];
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Record<string, unknown>;
    const logId = Number(a.chatbot_log_id);
    if (!Number.isInteger(logId)) continue;
    if (a.verdict !== 'bien' && a.verdict !== 'mal') continue;
    salida.push({
      chatbot_log_id: logId,
      verdict: a.verdict,
      comment: typeof a.comment === 'string' ? a.comment : null,
    });
  }
  return salida;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: 'Id de revisión inválido' }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const rating = body.rating as Rating;
  if (!RATINGS.includes(rating)) {
    return Response.json(
      { error: 'La calificación debe ser bien, regular o mal' },
      { status: 400 },
    );
  }

  const userEmail = auth.user?.email || 'desconocido';
  const anchors = normalizarAnclajes(body.anchors);

  // Primero se guarda el trabajo de la persona. Recién después se llama a la
  // IA: si el modelo falla, el feedback ya está a salvo.
  try {
    await saveFeedback({
      reviewId,
      rating,
      comment: typeof body.comment === 'string' ? body.comment : '',
      anchors,
      userEmail,
    });
  } catch (err) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'guardar_feedback',
      error: err,
      context: { reviewId },
    });
    return Response.json({ error: 'No se pudo guardar la revisión' }, { status: 500 });
  }

  try {
    const rule = await generateRuleForReview(reviewId, userEmail);
    return Response.json({ ok: true, rule, ruleError: null });
  } catch (err) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'generar_regla',
      error: err,
      context: { reviewId },
    });
    return Response.json({
      ok: true,
      rule: null,
      ruleError: 'No se pudo generar la regla. Tu revisión quedó guardada; podés reintentar.',
    });
  }
}
