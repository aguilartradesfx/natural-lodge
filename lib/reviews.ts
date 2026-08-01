import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildTranscript } from '@/lib/review-summary';
import { draftRuleFromFeedback, type RuleKind, type RuleStatus } from '@/lib/learned-rules';
import type { ChatbotLog, Signal } from '@/lib/conversation-episodes';

/**
 * Persistencia de la bandeja de revisión. Las rutas API son envolturas
 * delgadas sobre estas funciones, lo que las hace testeables mockeando este
 * módulo en lugar de simular toda la cadena de Supabase.
 */

export type ReviewRow = {
  id: number;
  phone: string;
  agente: string;
  contact_id: string | null;
  window_start: string;
  window_end: string;
  turn_count: number;
  summary: string | null;
  topics: string[];
  outcome: string | null;
  risk_score: number;
  signals: Signal[];
  priority: number;
  status: string;
  human_rating: string | null;
  human_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export type AnchorInput = {
  chatbot_log_id: number;
  verdict: 'bien' | 'mal';
  comment: string | null;
};

export type RuleRow = {
  id: number;
  agent_key: string;
  source_review_id: number | null;
  trigger_text: string;
  rule_text: string;
  rationale: string | null;
  kind: RuleKind;
  conflict_excerpt: string | null;
  status: RuleStatus;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type ReviewDetail = {
  review: ReviewRow;
  logs: ChatbotLog[];
  anchors: (AnchorInput & { id: number })[];
  rules: RuleRow[];
};

function normalizarReview(fila: Record<string, unknown>): ReviewRow {
  return {
    ...(fila as unknown as ReviewRow),
    topics: Array.isArray(fila.topics) ? (fila.topics as string[]) : [],
    signals: Array.isArray(fila.signals) ? (fila.signals as Signal[]) : [],
  };
}

export async function listReviews(opts?: {
  status?: string;
  agente?: string;
  limit?: number;
}): Promise<ReviewRow[]> {
  const supabase = createAdminClient();
  let q = supabase
    .from('nlcn_conversation_reviews')
    .select('*')
    .order('priority', { ascending: false })
    .order('window_end', { ascending: false });

  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.agente) q = q.eq('agente', opts.agente);

  const { data, error } = await q.limit(opts?.limit ?? 100);
  if (error) throw new Error(error.message);

  return (data ?? []).map(normalizarReview);
}

export async function getReviewDetail(id: number): Promise<ReviewDetail | null> {
  const supabase = createAdminClient();

  const { data: fila, error } = await supabase
    .from('nlcn_conversation_reviews')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!fila) return null;

  const review = normalizarReview(fila);

  // Los logs del episodio se recuperan por su ventana temporal: es la misma
  // definición que usó el barrido para crear la revisión.
  const { data: logs } = await supabase
    .from('chatbot_logs')
    .select(
      'id, phone, contact_id, message_in, message_out, has_reservation, agente_usado, transferir_a_ventas, created_at',
    )
    .eq('phone', review.phone)
    .gte('created_at', review.window_start)
    .lte('created_at', review.window_end)
    .order('created_at', { ascending: true });

  const { data: anchors } = await supabase
    .from('nlcn_message_feedback')
    .select('id, chatbot_log_id, verdict, comment')
    .eq('review_id', id);

  const { data: rules } = await supabase
    .from('nlcn_learned_rules')
    .select('*')
    .eq('source_review_id', id)
    .order('created_at', { ascending: false });

  return {
    review,
    logs: (logs ?? []) as ChatbotLog[],
    anchors: (anchors ?? []) as (AnchorInput & { id: number })[],
    rules: (rules ?? []) as RuleRow[],
  };
}

/**
 * Guarda el trabajo de la persona. Se llama SIEMPRE antes de tocar la IA:
 * ningún fallo del modelo puede hacer que alguien pierda lo que escribió.
 */
export async function saveFeedback(input: {
  reviewId: number;
  rating: 'bien' | 'regular' | 'mal';
  comment: string;
  anchors: AnchorInput[];
  userEmail: string;
}): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('nlcn_conversation_reviews')
    .update({
      human_rating: input.rating,
      human_comment: input.comment.trim() || null,
      status: 'revisada',
      reviewed_by: input.userEmail,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', input.reviewId);

  if (error) throw new Error(error.message);

  // Reemplazo, no acumulación: si alguien reabre la conversación y cambia de
  // opinión sobre qué respuesta falló, deben quedar solo sus marcas actuales.
  await supabase.from('nlcn_message_feedback').delete().eq('review_id', input.reviewId);

  if (input.anchors.length > 0) {
    const { error: insertError } = await supabase.from('nlcn_message_feedback').insert(
      input.anchors.map((a) => ({
        review_id: input.reviewId,
        chatbot_log_id: a.chatbot_log_id,
        verdict: a.verdict,
        comment: a.comment?.trim() || null,
        created_by: input.userEmail,
      })),
    );
    if (insertError) throw new Error(insertError.message);
  }
}

/**
 * Convierte el feedback ya guardado en una regla propuesta. Devuelve null si
 * no hay nada que convertir (calificación sin comentario ni marcas).
 */
export async function generateRuleForReview(
  reviewId: number,
  userEmail: string,
): Promise<RuleRow | null> {
  const detalle = await getReviewDetail(reviewId);
  if (!detalle) return null;

  const comentario = detalle.review.human_comment?.trim() || '';
  const conComentarioEnAnclaje = detalle.anchors.some((a) => a.comment?.trim());
  if (!comentario && !conComentarioEnAnclaje) return null;

  const supabase = createAdminClient();
  const { data: promptRow } = await supabase
    .from('nlcn_agent_prompts')
    .select('system_prompt')
    .eq('agent_key', detalle.review.agente)
    .maybeSingle();

  const porId = new Map(detalle.logs.map((l) => [l.id, l]));

  const draft = await draftRuleFromFeedback({
    transcript: buildTranscript(detalle.logs),
    summary: detalle.review.summary || '',
    comment: comentario,
    anchors: detalle.anchors.map((a) => ({
      message_out: porId.get(a.chatbot_log_id)?.message_out || '',
      comment: a.comment,
    })),
    agente: detalle.review.agente,
    currentPrompt: String(promptRow?.system_prompt || ''),
  });

  const { data, error } = await supabase
    .from('nlcn_learned_rules')
    .insert({
      agent_key: draft.agent_key,
      source_review_id: reviewId,
      trigger_text: draft.trigger_text,
      rule_text: draft.rule_text,
      rationale: draft.rationale,
      kind: draft.kind,
      conflict_excerpt: draft.conflict_excerpt,
      status: 'propuesta',
      created_by: userEmail,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as RuleRow;
}
