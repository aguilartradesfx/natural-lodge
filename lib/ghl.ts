import 'server-only';

/**
 * Cliente REST de GoHighLevel (LeadConnector).
 *
 * Este es el runtime real que reemplaza los nodos de n8n. El MCP de GHL
 * es solo para desarrollo/pruebas; producción habla con la API REST
 * directamente usando el Private Integration Token.
 */

const BASE_URL = 'https://services.leadconnectorhq.com';

export const GHL_LOCATION_ID =
  process.env.GHL_LOCATION_ID || 'M649NrxtUHpNCNxTC5U1';

export const GHL_CALENDAR_ID =
  process.env.GHL_CALENDAR_ID || 'viqiwKhTn4fwtPmOGjfz';

function token(): string {
  const t = process.env.GHL_PRIVATE_INTEGRATION;
  if (!t) throw new Error('[ghl] Falta GHL_PRIVATE_INTEGRATION en el entorno');
  return t;
}

type GhlFetchOpts = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  version?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
};

export class GhlError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, path: string) {
    super(`GHL ${status} en ${path}: ${body.slice(0, 300)}`);
    this.name = 'GhlError';
    this.status = status;
    this.body = body;
  }
}

async function ghlFetch<T = unknown>(path: string, opts: GhlFetchOpts = {}): Promise<T> {
  const { method = 'GET', version = '2021-04-15', body, query } = opts;

  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Version: version,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new GhlError(res.status, text, path);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Reintenta una operación GHL con backoff simple (para fallos transitorios). */
async function withRetry<T>(fn: () => Promise<T>, tries = 3, waitMs = 2000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // No reintentar errores de cliente (4xx que no sean 429).
      if (err instanceof GhlError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }
      if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ── Contactos ────────────────────────────────────────────────────

export type GhlContact = {
  id: string;
  locationId?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
};

/**
 * Upsert de contacto (crea o actualiza por email/phone). Devuelve el
 * contacto con su id — elimina la necesidad del "wait + get contact"
 * que tenía el flujo de n8n.
 */
export async function upsertContact(input: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  locationId?: string;
}): Promise<GhlContact> {
  const data = await withRetry(() =>
    ghlFetch<{ contact: GhlContact }>('/contacts/upsert', {
      method: 'POST',
      version: '2021-07-28',
      body: {
        locationId: input.locationId || GHL_LOCATION_ID,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email || undefined,
        phone: input.phone || undefined,
      },
    }),
  );
  return data.contact;
}

/**
 * Tags reales del contacto en GHL.
 *
 * El webhook trae un campo `tags`, pero no siempre: cuando falta, el tag
 * "bot desactivado" que el equipo puso a mano quedaba ignorado y el bot le
 * respondía igual a un contacto silenciado.
 */
export async function getContactTags(contactId: string): Promise<string[]> {
  const data = await withRetry(() =>
    ghlFetch<{ contact?: GhlContact }>(`/contacts/${contactId}`, {
      version: '2021-07-28',
    }),
  );
  return data.contact?.tags ?? [];
}

export async function addContactTags(contactId: string, tags: string[]): Promise<void> {
  await withRetry(() =>
    ghlFetch(`/contacts/${contactId}/tags`, {
      method: 'POST',
      version: '2021-07-28',
      body: { tags },
    }),
  );
}

// ── Calendario / Citas ───────────────────────────────────────────

export type GhlAppointment = { id: string };

export async function createAppointment(input: {
  contactId: string;
  startTime: string;
  endTime: string;
  title: string;
  calendarId?: string;
  locationId?: string;
}): Promise<GhlAppointment> {
  const data = await withRetry(() =>
    ghlFetch<Record<string, unknown>>('/calendars/events/appointments', {
      method: 'POST',
      version: '2021-04-15',
      body: {
        calendarId: input.calendarId || GHL_CALENDAR_ID,
        locationId: input.locationId || GHL_LOCATION_ID,
        contactId: input.contactId,
        startTime: input.startTime,
        endTime: input.endTime,
        title: input.title,
        ignoreDateRange: true,
      },
    }),
  );
  const id = extractAppointmentId(data);
  if (!id) {
    // No tragamos el id en silencio: si GHL creó la cita pero no devolvió
    // id reconocible, lo surfaceamos con la respuesta cruda para depurar.
    throw new GhlError(200, JSON.stringify(data).slice(0, 500), '/calendars/events/appointments (sin id)');
  }
  return { id };
}

function extractAppointmentId(data: Record<string, unknown>): string | undefined {
  const candidates = [
    data.id,
    data.appointmentId,
    (data.event as Record<string, unknown> | undefined)?.id,
    (data.appointment as Record<string, unknown> | undefined)?.id,
    (data.calendarEvent as Record<string, unknown> | undefined)?.id,
    (data.data as Record<string, unknown> | undefined)?.id,
  ];
  const found = candidates.find((c) => typeof c === 'string' && c.length > 0);
  return found as string | undefined;
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  await withRetry(() =>
    ghlFetch(`/calendars/events/${appointmentId}`, {
      method: 'DELETE',
      version: '2021-04-15',
    }),
  );
}

// ── Conversaciones / Mensajes (para el chatbot) ──────────────────

export type GhlMessage = {
  id?: string;
  conversationId?: string;
  direction?: 'inbound' | 'outbound';
  messageType?: string;
  type?: number;
  body?: string;
  dateAdded?: string;
  attachments?: Array<string | { url?: string; fileUrl?: string }>;
};

/**
 * La búsqueda de conversaciones ya trae el canal y el cuerpo del último
 * mensaje. Es una segunda fuente para el mismo dato: cuando
 * /conversations/{id}/messages devuelve vacío (GHL suele indexar con
 * retraso), esto sigue diciendo por dónde escribió el huésped.
 */
export type GhlConversation = {
  id: string;
  lastMessageType?: string;
  lastMessageBody?: string;
  lastMessageDate?: string | number;
  lastMessageDirection?: 'inbound' | 'outbound';
};

function toMillis(value?: string | number): number {
  if (value === undefined || value === null) return 0;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Todas las conversaciones del contacto, de la más reciente a la más vieja.
 *
 * Antes se pedía `limit: 1` y se tomaba lo que viniera primero: con un
 * contacto que tiene IG y SMS abiertos, eso elegía la conversación
 * equivocada y el bot contestaba por el canal equivocado.
 */
export async function searchConversations(input: {
  contactId: string;
  locationId?: string;
}): Promise<GhlConversation[]> {
  const data = await ghlFetch<{ conversations?: GhlConversation[] }>(
    '/conversations/search',
    {
      version: '2021-04-15',
      query: {
        locationId: input.locationId || GHL_LOCATION_ID,
        contactId: input.contactId,
        limit: 20,
      },
    },
  );
  const list = data.conversations ?? [];
  return [...list].sort((a, b) => toMillis(b.lastMessageDate) - toMillis(a.lastMessageDate));
}

export async function getConversationMessages(
  conversationId: string,
  limit = 5,
): Promise<GhlMessage[]> {
  const data = await ghlFetch<{ messages?: GhlMessage[] | { messages?: GhlMessage[] } }>(
    `/conversations/${conversationId}/messages`,
    { version: '2021-04-15', query: { limit } },
  );
  if (Array.isArray(data.messages)) return data.messages;
  if (data.messages && Array.isArray(data.messages.messages)) return data.messages.messages;
  return [];
}

export async function sendMessage(input: {
  type: string;
  contactId: string;
  message: string;
}): Promise<void> {
  await withRetry(() =>
    ghlFetch('/conversations/messages', {
      method: 'POST',
      version: '2021-04-15',
      body: { type: input.type, contactId: input.contactId, message: input.message },
    }),
  );
}

/**
 * Mete el contacto en un workflow de GHL. Es lo que avisa al equipo cuando
 * el bot escala una conversación: sin esto el huésped recibe un "en breve
 * te contactamos" que no le llega a nadie.
 *
 * Requiere que el Private Integration Token tenga el scope de workflows.
 */
export async function addContactToWorkflow(
  contactId: string,
  workflowId: string,
): Promise<void> {
  await withRetry(() =>
    ghlFetch(`/contacts/${contactId}/workflow/${workflowId}`, {
      method: 'POST',
      version: '2021-07-28',
      body: { eventStartTime: ghlTimestamp() },
    }),
  );
}

/**
 * Marca de tiempo en el formato que exige GHL: offset numérico explícito y
 * sin milisegundos.
 *
 * `toISOString()` produce `2026-08-08T22:11:44.118Z` y GHL lo rechaza con un
 * 422 pidiendo "a date and time with timezone offset" — la `Z` no le sirve
 * aunque sea ISO 8601 válido.
 */
export function ghlTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

// ── Inbound Webhooks (capture URLs que disparan automatizaciones en GHL) ──
// Estos NO usan el token; son URLs públicas de captura. Se conservan para
// no romper las automatizaciones que el equipo ya tiene montadas en GHL.

export const GHL_INBOUND_HOOKS = {
  contactoReserva:
    process.env.GHL_HOOK_CONTACTO || '616a3d67-e8c4-42d2-974b-3754c3f22d77',
  marcarCancelado:
    process.env.GHL_HOOK_CANCELADO || 'PCvrU9a2BgSa1YOkbPdK',
  // Etiquetas proactivas (Flujo 2)
  etiqueta3Dias: process.env.GHL_HOOK_ETIQUETA_3DIAS || 'amWLGJtUeNK3kWod6tHK',
  etiquetaManana:
    process.env.GHL_HOOK_ETIQUETA_MANANA || '8a0ba778-2ea4-4d5c-9e6e-56ecbc3ef5d0',
  etiquetaHoy: process.env.GHL_HOOK_ETIQUETA_HOY || '4D7nbb7PRXaw8lCVWLCi',
  etiquetaCheckout: process.env.GHL_HOOK_ETIQUETA_CHECKOUT || '6jl4JCkS9tqKwWCUhq6R',
};

/**
 * Dispara un inbound webhook de GHL (la "Custom Webhook" / trigger de
 * automatización). No bloquea el flujo si falla — solo registra en consola.
 */
export async function fireInboundWebhook(
  triggerId: string,
  body: Record<string, unknown>,
  locationId: string = GHL_LOCATION_ID,
): Promise<void> {
  try {
    const url = `${BASE_URL}/hooks/${locationId}/webhook-trigger/${triggerId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[ghl] inbound webhook ${triggerId} -> ${res.status}`);
    }
  } catch (err) {
    console.error(`[ghl] inbound webhook ${triggerId} falló`, err);
  }
}

// ── Importador de contactos ──────────────────────────────────────

export type GhlContactFields = {
  firstName?: string;
  lastName?: string;
  name?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  website?: string;
  city?: string;
  state?: string;
  country?: string;
  source?: string;
  customFields?: Array<{ id: string; field_value: string }>;
  locationId?: string;
};

/** Quita claves undefined/'' y arrays vacíos, para no pisar datos en GHL. */
function cleanBody<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export async function searchContacts(input: {
  query: string;
  locationId?: string;
}): Promise<GhlContact[]> {
  const data = await withRetry(() =>
    ghlFetch<{ contacts?: GhlContact[] }>('/contacts/', {
      version: '2021-07-28',
      query: {
        locationId: input.locationId || GHL_LOCATION_ID,
        query: input.query,
        limit: 20,
      },
    }),
  );
  return data.contacts ?? [];
}

export async function createContact(input: GhlContactFields): Promise<GhlContact> {
  const { locationId, ...rest } = input;
  const data = await withRetry(() =>
    ghlFetch<{ contact: GhlContact }>('/contacts/', {
      method: 'POST',
      version: '2021-07-28',
      body: cleanBody({ locationId: locationId || GHL_LOCATION_ID, ...rest }),
    }),
  );
  return data.contact;
}

export async function updateContact(
  contactId: string,
  input: GhlContactFields,
): Promise<GhlContact> {
  const { locationId: _ignored, ...rest } = input;
  const data = await withRetry(() =>
    ghlFetch<{ contact: GhlContact }>(`/contacts/${contactId}`, {
      method: 'PUT',
      version: '2021-07-28',
      body: cleanBody(rest),
    }),
  );
  return data.contact;
}

export async function createNote(
  contactId: string,
  body: string,
  _locationId: string = GHL_LOCATION_ID,
): Promise<void> {
  await withRetry(() =>
    ghlFetch(`/contacts/${contactId}/notes`, {
      method: 'POST',
      version: '2021-07-28',
      body: { body },
    }),
  );
}

export type GhlPipeline = {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
};

export async function getPipelines(locationId: string = GHL_LOCATION_ID): Promise<GhlPipeline[]> {
  const data = await withRetry(() =>
    ghlFetch<{ pipelines?: GhlPipeline[] }>('/opportunities/pipelines', {
      version: '2021-07-28',
      query: { locationId },
    }),
  );
  return data.pipelines ?? [];
}

export type GhlCustomField = {
  id: string;
  name: string;
  fieldKey?: string;
  dataType?: string;
};

export async function getCustomFields(
  locationId: string = GHL_LOCATION_ID,
): Promise<GhlCustomField[]> {
  const data = await withRetry(() =>
    ghlFetch<{ customFields?: GhlCustomField[] }>(`/locations/${locationId}/customFields`, {
      version: '2021-07-28',
    }),
  );
  return data.customFields ?? [];
}

export async function createOpportunity(input: {
  pipelineId: string;
  stageId: string;
  name: string;
  contactId: string;
  status?: string;
  monetaryValue?: number;
  locationId?: string;
}): Promise<{ id: string }> {
  const data = await withRetry(() =>
    ghlFetch<{ opportunity?: { id: string }; id?: string }>('/opportunities/', {
      method: 'POST',
      version: '2021-07-28',
      body: {
        pipelineId: input.pipelineId,
        locationId: input.locationId || GHL_LOCATION_ID,
        name: input.name,
        pipelineStageId: input.stageId,
        status: input.status || 'open',
        contactId: input.contactId,
        monetaryValue: input.monetaryValue ?? 0,
      },
    }),
  );
  const id = data.opportunity?.id || data.id;
  if (!id) throw new GhlError(200, JSON.stringify(data).slice(0, 300), '/opportunities/ (sin id)');
  return { id };
}
