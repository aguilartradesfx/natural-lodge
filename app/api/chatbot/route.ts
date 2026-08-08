import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { anthropic, ANTHROPIC_MODEL, NO_THINKING } from '@/lib/anthropic';
import {
  decideRoute,
  ESCALATION_RESPONSE,
  type AgentKey,
} from '@/lib/agent-router';
import { buildFullSystemPrompt, type MockReservation } from '@/lib/prompt-context';
import { sanitizeAgentResponse } from '@/lib/prompt-sanitizer';
import {
  searchConversations,
  getConversationMessages,
  sendMessage,
  addContactToWorkflow,
  getContactTags,
  type GhlConversation,
  type GhlMessage,
} from '@/lib/ghl';
import {
  processLastMessage,
  mapMessageTypeToChannel,
  esRecuperable,
  type ProcessedMessage,
} from '@/lib/chatbot-message';
import { describeImage } from '@/lib/vision';
import { transcribeAudio } from '@/lib/transcribe';
import { findActiveReservation } from '@/lib/reservas';
import { getEventAgent } from '@/lib/event-agent';
import { getHistory, appendTurns, sessionKey } from '@/lib/chat-memory';
import { logWorkflowError } from '@/lib/error-log';
import { CHATBOT_FALLBACK_MESSAGE } from '@/lib/review-constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'chatbot_v2';

/**
 * Debounce ANTES de leer la conversación (antes estaba antes de enviar).
 * Cumple dos funciones: agrupa los mensajes que el huésped manda seguidos, y
 * le da tiempo a GHL a indexar el mensaje que disparó el webhook — su API
 * suele devolver la conversación vacía si se consulta al instante.
 */
const READ_DELAY_MS = Number(
  process.env.CHATBOT_READ_DELAY_MS ?? process.env.CHATBOT_SEND_DELAY_MS ?? 30000,
);

/** Esperas entre reintentos de lectura de mensajes. */
const MESSAGE_RETRY_DELAYS_MS = [2000, 5000, 10000];

/**
 * Presupuesto total del procesamiento en background. Vercel corta la función
 * a los `maxDuration` segundos y todo lo que quede a medias se pierde en
 * silencio: sin respuesta enviada y sin log.
 */
const TIME_BUDGET_MS = Number(process.env.CHATBOT_TIME_BUDGET_MS ?? 50_000);

/** Tiempo que hay que dejar libre para Claude, el envío y el log. */
const RESERVA_RESPUESTA_MS = 25_000;

/** Tag que silencia al bot para un contacto puntual. */
const TAG_SILENCIO = 'bot desactivado';

/** Workflow de GHL que avisa al equipo cuando el bot escala. */
const ESCALATION_WORKFLOW_ID =
  process.env.GHL_ESCALATION_WORKFLOW_ID || 'ba255d47-c90c-425e-8ea7-6b5d9a6211f0';

/** Ventana de servicio de WhatsApp: fuera de ella solo entran plantillas. */
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Antigüedad máxima para considerar que una conversación espera respuesta. */
const VENTANA_PENDIENTES_MS = 15 * 60 * 1000;

/** Tope de conversaciones atendidas por corrida, para acotar el tiempo. */
const MAX_CONVERSACIONES = 3;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  // ── 0) Seguridad opcional: secreto compartido (mismo patrón que Orbe) ──
  // Sin esto la ruta está abierta: cualquiera con la URL dispara respuestas y
  // consume tokens. Es opcional para no romper el webhook ya configurado en
  // GHL; en cuanto la variable existe, se exige.
  const secret = process.env.CHATBOT_WEBHOOK_SECRET;
  if (secret) {
    const provided =
      req.headers.get('x-chatbot-secret') ||
      new URL(req.url).searchParams.get('secret') ||
      '';
    if (provided !== secret) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }
  }

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

  /**
   * Identidad del huésped para memoria y rate-limit: el teléfono cuando
   * existe, el contacto cuando no.
   *
   * Antes el teléfono era obligatorio y sin él se devolvía 400. Un DM de
   * Instagram o Facebook llega de un contacto que muchas veces no tiene
   * teléfono, así que el bot nunca respondía por esos canales. El contacto
   * es la identidad real; el teléfono es solo un dato más.
   */
  const identidad = phone || contactId;

  // ── 3) Rate limit (≥10 msgs en 60s) ───────────────────────────
  try {
    const since = new Date(Date.now() - 60_000).toISOString();
    const base = supabase
      .from('chatbot_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since);
    const { count } = await (phone
      ? base.eq('phone', phone)
      : base.eq('contact_id', contactId));
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
      await processConversation({ contactId, phone, identidad, email, locationId });
    } catch (err) {
      await logWorkflowError({ workflow: WORKFLOW, error: err, context: { contactId, phone } });
    }
  });

  return Response.json({ ok: true, queued: true });
}

// ════════════════════════════════════════════════════════════════
// Procesamiento asíncrono de la conversación
// ════════════════════════════════════════════════════════════════

type Ctx = {
  contactId: string;
  phone: string;
  /** Teléfono si existe, contacto si no. Clave de memoria y rate-limit. */
  identidad: string;
  email: string;
  locationId: string;
};

type Salida = {
  mensaje: string;
  inboundChannel: string | null;
  agente: string;
  hasReservation: boolean;
  messageIn: string;
  transferToSales: boolean;
  conversationId: string;
  /** Última entrada del huésped, para la ventana de 24h de WhatsApp. */
  ultimoInboundMs: number;
  /** Si hay que avisarle al equipo por el workflow de GHL. */
  escalar: boolean;
};

async function processConversation(ctx: Ctx): Promise<void> {
  const limite = Date.now() + TIME_BUDGET_MS;
  const restante = () => limite - Date.now();

  // El debounce va acá: agrupa mensajes seguidos y le da tiempo a GHL a
  // indexar. Antes esperaba justo antes de enviar, donde no servía para nada
  // salvo consumir el presupuesto de la función. Se recorta para que siempre
  // quede tiempo de contestar.
  const espera = Math.min(READ_DELAY_MS, restante() - RESERVA_RESPUESTA_MS);
  if (espera > 0) await sleep(espera);

  // El tag manda sobre el body del webhook: GHL no siempre incluye `tags`, y
  // cuando falta el contacto silenciado recibía respuestas igual.
  if (await estaSilenciado(ctx.contactId)) return;

  const conversaciones = await searchConversations({
    contactId: ctx.contactId,
    locationId: ctx.locationId,
  });

  // Sin conversación no sabemos por qué canal escribió. Callarse es mejor que
  // contestar por un canal adivinado: en WhatsApp sin ventana abierta el
  // mensaje se pierde igual, y el huésped ve al bot hablando solo.
  if (conversaciones.length === 0) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'buscar_conversacion',
      error: new Error('GHL no devolvió ninguna conversación para el contacto'),
      context: { contactId: ctx.contactId, phone: ctx.phone },
    });
    return;
  }

  // El webhook no dice a qué conversación pertenece el mensaje que lo disparó.
  // Antes se atendía solo la más reciente del contacto, y un huésped que
  // escribía por WhatsApp y SMS casi a la vez recibía UNA sola respuesta: los
  // dos webhooks convergían en la misma conversación y la idempotencia
  // descartaba al segundo. Ahora se atienden todas las que tengan entrada
  // fresca; la tabla de idempotencia garantiza una respuesta por mensaje.
  for (const conv of conversacionesPendientes(conversaciones)) {
    if (restante() < RESERVA_RESPUESTA_MS) break;
    await atenderConversacion(ctx, conv, restante);
  }
}

/**
 * Conversaciones que pueden tener un mensaje sin contestar: las que terminan
 * en una entrada del huésped y son recientes. Si ninguna califica se cae a la
 * más reciente, que es el comportamiento anterior.
 */
function conversacionesPendientes(convs: GhlConversation[]): GhlConversation[] {
  const ahora = Date.now();
  const frescas = convs.filter((c) => {
    if (c.lastMessageDirection === 'outbound') return false;
    const ms =
      typeof c.lastMessageDate === 'number'
        ? c.lastMessageDate
        : Date.parse(String(c.lastMessageDate ?? ''));
    return Number.isFinite(ms) && ahora - ms < VENTANA_PENDIENTES_MS;
  });
  return (frescas.length > 0 ? frescas : convs.slice(0, 1)).slice(0, MAX_CONVERSACIONES);
}

/** Atiende una conversación concreta: lee, decide y responde por su canal. */
async function atenderConversacion(
  ctx: Ctx,
  conv: GhlConversation,
  restante: () => number,
): Promise<void> {
  const canalConversacion = mapMessageTypeToChannel(conv.lastMessageType);
  const messages = await leerMensajes(conv.id, restante);

  let processed = processLastMessage(messages, canalConversacion);

  // La búsqueda de conversación ya trae el último mensaje. Si el endpoint de
  // mensajes vino vacío, ese cuerpo es un respaldo real — mucho mejor que
  // responder "no pude encontrar tu mensaje".
  if (!processed.procesable && esRecuperable(processed.reason)) {
    processed = desdeConversacion(conv, canalConversacion) ?? processed;
  }

  const conversationId = processed.conversationId || conv.id;
  const ultimoInbound = ultimoInboundMs(messages, conv);

  // Un solo turno por mensaje, aunque GHL dispare el webhook varias veces.
  const claveMensaje = processed.ghlMessageId || `${conv.id}:${conv.lastMessageDate ?? ''}`;
  if (await yaAtendido(claveMensaje, ctx.contactId)) return;

  const base = {
    inboundChannel: processed.inboundChannel,
    conversationId,
    ultimoInboundMs: ultimoInbound,
    hasReservation: false,
    messageIn: '',
    transferToSales: false,
    escalar: false,
  };

  if (!processed.procesable) {
    await deliver(ctx, {
      ...base,
      mensaje: processed.errorMessage || 'No pude procesar tu mensaje. ¿Podés intentar de nuevo?',
      agente: 'sistema',
    });
    return;
  }

  // Resolver multimedia → texto.
  const message = await resolveMedia(processed);
  if (message === null) {
    await deliver(ctx, {
      ...base,
      mensaje:
        'Por el momento no puedo procesar audios. Si querés contarme con palabras de qué se trata, con gusto te ayudo.',
      agente: 'sistema',
    });
    return;
  }

  // Reserva activa + ruteo determinístico. El agente de evento se lee del
  // panel: nombre, palabras y encendido son editables sin tocar código.
  const reservation = await findActiveReservation(ctx.phone, ctx.email);
  const hasReservation = !!reservation;
  const eventAgent = await getEventAgent();
  const decision = decideRoute({ message, hasReservation, eventAgent });

  if (decision.kind === 'escalation') {
    await deliver(ctx, {
      ...base,
      mensaje: ESCALATION_RESPONSE,
      agente: 'escalamiento',
      hasReservation,
      messageIn: message,
      escalar: true,
    });
    return;
  }

  const reply = await runAgent({
    agent: decision.agent,
    message,
    identidad: ctx.identidad,
    phone: ctx.phone,
    reservation,
  });

  await deliver(ctx, {
    ...base,
    mensaje: reply.mensaje,
    agente: decision.agent,
    hasReservation,
    messageIn: message,
    transferToSales: reply.transferToSales,
    // Prometer contacto y no avisarle a nadie es el peor de los dos mundos:
    // el traspaso a ventas dispara el mismo workflow que el escalamiento.
    escalar: reply.transferToSales,
  });
}

/**
 * ¿El equipo silenció al bot para este contacto? Si GHL no responde, seguimos:
 * quedarse mudo por un fallo de lectura es peor que contestar de más.
 */
async function estaSilenciado(contactId: string): Promise<boolean> {
  try {
    const tags = await getContactTags(contactId);
    return tags.some((t) => t.toLowerCase().includes(TAG_SILENCIO));
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'leer_tags', error: err });
    return false;
  }
}

/**
 * Lee los mensajes con reintentos. GHL indexa con retraso, así que un solo
 * intento devuelve vacío con frecuencia y el bot respondía un error.
 *
 * Los reintentos se cortan si no queda tiempo para contestar: prefiero
 * degradar a `lastMessageBody` que agotar el presupuesto reintentando.
 */
async function leerMensajes(
  conversationId: string,
  restante: () => number,
): Promise<GhlMessage[]> {
  for (let i = 0; i <= MESSAGE_RETRY_DELAYS_MS.length; i++) {
    try {
      // 20 y no 5: el bot suele mandar varias respuestas seguidas, y con una
      // ventana chica la última entrada del huésped queda fuera. Solo se usa
      // el inbound más reciente, así que traer de más no cuesta nada.
      const messages = await getConversationMessages(conversationId, 20);
      if (messages.length > 0) return messages;
    } catch (err) {
      await logWorkflowError({ workflow: WORKFLOW, node: 'obtener_mensajes', error: err });
    }
    if (i >= MESSAGE_RETRY_DELAYS_MS.length) break;
    const espera = MESSAGE_RETRY_DELAYS_MS[i];
    if (restante() - espera < RESERVA_RESPUESTA_MS) break;
    await sleep(espera);
  }
  return [];
}

/** Arma un mensaje procesable con lo que la conversación ya sabe. */
function desdeConversacion(
  conv: GhlConversation,
  canal: string | null,
): ProcessedMessage | null {
  const body = (conv.lastMessageBody || '').trim();
  if (!body || !canal) return null;
  if (conv.lastMessageDirection === 'outbound') return null;
  return {
    procesable: true,
    message: body,
    messageType: 'text',
    conversationId: conv.id,
    inboundChannel: canal,
  };
}

function ultimoInboundMs(messages: GhlMessage[], conv: GhlConversation): number {
  const fechas = messages
    .filter((m) => m.direction === 'inbound')
    .map((m) => Date.parse(m.dateAdded ?? ''))
    .filter((ms) => Number.isFinite(ms));
  if (fechas.length > 0) return Math.max(...fechas);

  if (conv.lastMessageDirection === 'outbound') return 0;
  const ms =
    typeof conv.lastMessageDate === 'number'
      ? conv.lastMessageDate
      : Date.parse(conv.lastMessageDate ?? '');
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Reclama el mensaje para esta corrida. El PRIMARY KEY resuelve la carrera:
 * si otra corrida ya lo insertó, esta se retira sin responder.
 */
async function yaAtendido(clave: string, contactId: string): Promise<boolean> {
  if (!clave) return false;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('chatbot_mensajes_atendidos')
    .insert({ ghl_message_id: clave, contact_id: contactId });
  if (!error) return false;
  if (error.code === '23505') return true; // clave duplicada: ya lo atendió otra
  // Si la tabla falla por otra razón, preferimos responder de más que callar.
  await logWorkflowError({
    workflow: WORKFLOW,
    node: 'idempotencia',
    error: new Error(error.message),
  });
  return false;
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
  identidad: string;
  phone: string;
  reservation: MockReservation | null;
}): Promise<{ mensaje: string; transferToSales: boolean }> {
  const supabase = createAdminClient();

  const { data: promptRow } = await supabase
    .from('nlcn_agent_prompts')
    .select('system_prompt')
    .eq('agent_key', input.agent)
    .maybeSingle();

  if (!promptRow?.system_prompt) {
    // Sin prompt el bot contesta genérico y parece un problema del modelo.
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'cargar_prompt',
      error: new Error(`Sin system_prompt para el agente "${input.agent}"`),
    });
  }

  const systemPrompt = buildFullSystemPrompt({
    systemPrompt: promptRow?.system_prompt || 'Eres un asistente del hotel.',
    guestContext: { phone: input.phone, reservation: input.reservation },
  });

  const key = sessionKey(input.identidad, input.agent);
  const history = await getHistory(key, MEMORY_WINDOW[input.agent]);
  // Anthropic exige que la conversación empiece con 'user'.
  while (history.length && history[0].role === 'assistant') history.shift();

  let raw = '';
  try {
    const res = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      thinking: NO_THINKING,
      system: systemPrompt,
      messages: [...history, { role: 'user', content: input.message }],
    });
    const block = res.content.find((b) => b.type === 'text');
    raw = block && block.type === 'text' ? block.text : '';
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'agente_' + input.agent, error: err });
  }

  if (!raw) {
    // Guardamos igual el turno del huésped: si no, el próximo mensaje llega
    // sin contexto y el bot vuelve a preguntar lo mismo.
    await appendTurns(key, [{ role: 'user', content: input.message }]);
    return { mensaje: CHATBOT_FALLBACK_MESSAGE, transferToSales: false };
  }

  const sanitized = sanitizeAgentResponse(raw);
  await appendTurns(key, [
    { role: 'user', content: input.message },
    { role: 'assistant', content: sanitized.message },
  ]);
  return { mensaje: sanitized.message, transferToSales: sanitized.transferToSales };
}

/**
 * ¿Podemos enviar por este canal? WhatsApp solo acepta mensaje libre dentro
 * de las 24h posteriores a la última entrada del huésped; fuera de eso hace
 * falta una plantilla aprobada por Meta y el envío se pierde en silencio.
 */
function puedeEnviar(canal: string, ultimoInbound: number): boolean {
  if (canal !== 'WhatsApp') return true;
  if (!ultimoInbound) return true; // sin dato, no bloqueamos
  return Date.now() - ultimoInbound < WHATSAPP_WINDOW_MS;
}

/** Envía la respuesta a GHL, dispara el escalamiento y registra el log. */
async function deliver(ctx: Ctx, out: Salida): Promise<void> {
  let enviado = false;

  if (!out.inboundChannel) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'enviar_ghl',
      error: new Error('Canal de entrada desconocido: no se envía respuesta'),
      context: { contactId: ctx.contactId, conversationId: out.conversationId },
    });
  } else if (!puedeEnviar(out.inboundChannel, out.ultimoInboundMs)) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'enviar_ghl',
      error: new Error('Fuera de la ventana de 24h de WhatsApp: requiere plantilla'),
      context: { contactId: ctx.contactId, conversationId: out.conversationId },
    });
  } else {
    try {
      await sendMessage({
        type: out.inboundChannel,
        contactId: ctx.contactId,
        message: out.mensaje,
      });
      enviado = true;
    } catch (err) {
      await logWorkflowError({ workflow: WORKFLOW, node: 'enviar_ghl', error: err });
    }
  }

  let workflowDisparado: boolean | null = null;
  if (out.escalar) {
    try {
      await addContactToWorkflow(ctx.contactId, ESCALATION_WORKFLOW_ID);
      workflowDisparado = true;
    } catch (err) {
      workflowDisparado = false;
      await logWorkflowError({
        workflow: WORKFLOW,
        node: 'workflow_escalamiento',
        error: err,
        context: { contactId: ctx.contactId, workflowId: ESCALATION_WORKFLOW_ID },
      });
    }
  }

  const supabase = createAdminClient();
  await supabase.from('chatbot_logs').insert({
    phone: ctx.phone,
    contact_id: ctx.contactId,
    conversation_id: out.conversationId,
    message_in: out.messageIn,
    // Se guarda siempre, enviado o no: el ciclo de revisión compara este texto
    // contra el fallback para detectar la señal `error_bot`.
    message_out: out.mensaje,
    enviado,
    canal: out.inboundChannel,
    has_reservation: out.hasReservation,
    agente_usado: out.agente,
    transferir_a_ventas: out.transferToSales,
    workflow_disparado: workflowDisparado,
  });
}
