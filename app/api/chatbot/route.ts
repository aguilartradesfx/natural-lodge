import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { anthropic, ANTHROPIC_MODEL } from '@/lib/anthropic';
import {
  decideRoute,
  ESCALATION_RESPONSE,
  type AgentKey,
} from '@/lib/agent-router';
import { buildFullSystemPrompt, type MockReservation } from '@/lib/prompt-context';
import { sanitizeAgentResponse } from '@/lib/prompt-sanitizer';
import {
  searchConversation,
  getConversationMessages,
  sendMessage,
} from '@/lib/ghl';
import { processLastMessage, type ProcessedMessage } from '@/lib/chatbot-message';
import { describeImage } from '@/lib/vision';
import { transcribeAudio } from '@/lib/transcribe';
import { findActiveReservation } from '@/lib/reservas';
import { getHistory, appendTurns, sessionKey } from '@/lib/chat-memory';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'chatbot_v2';
const SEND_DELAY_MS = Number(process.env.CHATBOT_SEND_DELAY_MS ?? 30000);
const RATE_LIMIT_MAX = 10;

const MEMORY_WINDOW: Record<AgentKey, number> = {
  soporte: 30,
  bigday: 20,
  ventas: 30,
};

type Body = Record<string, unknown>;

function pick(body: Body, ...keys: string[]): string {
  for (const k of keys) {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // ── 1) Toggle global + tag por contacto ───────────────────────
  let globalBotEnabled = true;
  try {
    const { data } = await supabase
      .from('nlcn_bot_state')
      .select('is_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (data) globalBotEnabled = data.is_enabled !== false;
  } catch {
    /* si falla la lectura, asumimos activo (como n8n) */
  }

  const rawTags = body.tags;
  const tagsStr = Array.isArray(rawTags) ? rawTags.join(',') : String(rawTags ?? '');
  const contactDisabled = tagsStr.toLowerCase().includes('bot desactivado');

  if (!globalBotEnabled || contactDisabled) {
    return Response.json({
      silenciado: true,
      motivo: !globalBotEnabled
        ? 'Bot desactivado globalmente desde el panel'
        : 'Bot desactivado para este contacto',
    });
  }

  // ── 2) Validar y normalizar ───────────────────────────────────
  const contactId = pick(body, 'contact_id', 'contactId');
  const phone = pick(body, 'celular', 'phone', 'contactPhone', 'from').replace(/[^0-9+]/g, '');
  const email = pick(body, 'email').toLowerCase();
  const locationId =
    (body.location && typeof body.location === 'object'
      ? String((body.location as Body).id ?? '')
      : '') || 'M649NrxtUHpNCNxTC5U1';

  if (!contactId) {
    return Response.json({ error: true, code: 400, mensaje: 'Falta contact_id' }, { status: 400 });
  }
  if (!phone) {
    return Response.json({ error: true, code: 400, mensaje: 'Falta phone' }, { status: 400 });
  }

  // ── 3) Rate limit (≥10 msgs en 60s) ───────────────────────────
  try {
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabase
      .from('chatbot_logs')
      .select('id', { count: 'exact', head: true })
      .eq('phone', phone)
      .gte('created_at', since);
    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      return Response.json(
        { error: true, code: 429, mensaje: 'Demasiadas solicitudes. Por favor espera un momento.' },
        { status: 429 },
      );
    }
  } catch {
    /* si falla el rate-limit, continuamos */
  }

  // ── 4) Ack inmediato + procesamiento en background ─────────────
  after(async () => {
    try {
      await processConversation({ contactId, phone, email, locationId });
    } catch (err) {
      await logWorkflowError({ workflow: WORKFLOW, error: err, context: { contactId, phone } });
    }
  });

  return Response.json({ ok: true, queued: true });
}

// ════════════════════════════════════════════════════════════════
// Procesamiento asíncrono de la conversación
// ════════════════════════════════════════════════════════════════

type Ctx = { contactId: string; phone: string; email: string; locationId: string };

async function processConversation(ctx: Ctx): Promise<void> {
  // Traer la conversación y los últimos mensajes desde GHL.
  let messages: Awaited<ReturnType<typeof getConversationMessages>> = [];
  const conv = await searchConversation({ contactId: ctx.contactId, locationId: ctx.locationId });
  if (conv) messages = await getConversationMessages(conv.id, 5);

  const processed = processLastMessage(messages);

  if (!processed.procesable) {
    await deliver(ctx, {
      mensaje: processed.errorMessage || 'No pude procesar tu mensaje. ¿Podés intentar de nuevo?',
      inboundChannel: processed.inboundChannel,
      agente: 'sistema',
      hasReservation: false,
      messageIn: '',
      transferToSales: false,
    });
    return;
  }

  // Resolver multimedia → texto.
  const message = await resolveMedia(processed);
  if (message === null) {
    await deliver(ctx, {
      mensaje:
        'Por el momento no puedo procesar audios. Si querés contarme con palabras de qué se trata, con gusto te ayudo.',
      inboundChannel: processed.inboundChannel,
      agente: 'sistema',
      hasReservation: false,
      messageIn: '',
      transferToSales: false,
    });
    return;
  }

  // Reserva activa + ruteo determinístico.
  const reservation = await findActiveReservation(ctx.phone, ctx.email);
  const hasReservation = !!reservation;
  const decision = decideRoute({ message, hasReservation });

  if (decision.kind === 'escalation') {
    await deliver(ctx, {
      mensaje: ESCALATION_RESPONSE,
      inboundChannel: processed.inboundChannel,
      agente: 'escalamiento',
      hasReservation,
      messageIn: message,
      transferToSales: false,
    });
    return;
  }

  const reply = await runAgent({
    agent: decision.agent,
    message,
    phone: ctx.phone,
    reservation,
  });

  await deliver(ctx, {
    mensaje: reply.mensaje,
    inboundChannel: processed.inboundChannel,
    agente: decision.agent,
    hasReservation,
    messageIn: message,
    transferToSales: reply.transferToSales,
  });
}

/** Convierte imagen/audio a texto. Devuelve null si el audio no se pudo transcribir. */
async function resolveMedia(p: ProcessedMessage): Promise<string | null> {
  if (p.messageType === 'image' && p.attachmentUrl) {
    const desc = await describeImage(p.attachmentUrl).catch(() => 'No se pudo procesar la imagen');
    const caption = p.message || '';
    return caption
      ? `[El usuario envió una imagen. Descripción]: ${desc}\n\nMensaje del usuario: ${caption}`
      : `[El usuario envió una imagen. Descripción]: ${desc}\n\n(El usuario no escribió texto adicional)`;
  }
  if (p.messageType === 'audio' && p.attachmentUrl) {
    try {
      const trans = await transcribeAudio(p.attachmentUrl);
      return `[El usuario envió un audio. Transcripción]: ${trans}`;
    } catch (err) {
      await logWorkflowError({ workflow: WORKFLOW, node: 'transcribe', error: err });
      return null;
    }
  }
  return p.message || '';
}

/** Corre el agente Claude con memoria y devuelve la respuesta sanitizada. */
async function runAgent(input: {
  agent: AgentKey;
  message: string;
  phone: string;
  reservation: MockReservation | null;
}): Promise<{ mensaje: string; transferToSales: boolean }> {
  const supabase = createAdminClient();

  const { data: promptRow } = await supabase
    .from('nlcn_agent_prompts')
    .select('system_prompt')
    .eq('agent_key', input.agent)
    .maybeSingle();

  const systemPrompt = buildFullSystemPrompt({
    systemPrompt: promptRow?.system_prompt || 'Eres un asistente del hotel.',
    guestContext: { phone: input.phone, reservation: input.reservation },
  });

  const key = sessionKey(input.phone, input.agent);
  const history = await getHistory(key, MEMORY_WINDOW[input.agent]);
  // Anthropic exige que la conversación empiece con 'user'.
  while (history.length && history[0].role === 'assistant') history.shift();

  let raw = '';
  try {
    const res = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [...history, { role: 'user', content: input.message }],
    });
    const block = res.content.find((b) => b.type === 'text');
    raw = block && block.type === 'text' ? block.text : '';
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'agente_' + input.agent, error: err });
  }

  if (!raw) {
    return {
      mensaje:
        '¡Hola! Disculpa, tengo dificultades para procesar tu consulta en este momento. ¿Podrías intentar nuevamente o comunicarte directamente con nuestra recepción?',
      transferToSales: false,
    };
  }

  const sanitized = sanitizeAgentResponse(raw);
  await appendTurns(key, [
    { role: 'user', content: input.message },
    { role: 'assistant', content: sanitized.message },
  ]);
  return { mensaje: sanitized.message, transferToSales: sanitized.transferToSales };
}

/** Espera el delay de debounce, envía la respuesta a GHL y registra el log. */
async function deliver(
  ctx: Ctx,
  out: {
    mensaje: string;
    inboundChannel: string;
    agente: string;
    hasReservation: boolean;
    messageIn: string;
    transferToSales: boolean;
  },
): Promise<void> {
  if (SEND_DELAY_MS > 0) await new Promise((r) => setTimeout(r, SEND_DELAY_MS));

  try {
    await sendMessage({
      type: out.inboundChannel,
      contactId: ctx.contactId,
      message: out.mensaje,
    });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'enviar_ghl', error: err });
  }

  const supabase = createAdminClient();
  await supabase.from('chatbot_logs').insert({
    phone: ctx.phone,
    contact_id: ctx.contactId,
    conversation_id: '',
    message_in: out.messageIn,
    message_out: out.mensaje,
    has_reservation: out.hasReservation,
    agente_usado: out.agente,
    transferir_a_ventas: out.transferToSales,
  });
}
