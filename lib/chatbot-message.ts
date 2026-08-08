import type { GhlMessage } from '@/lib/ghl';

/**
 * Procesa el último mensaje inbound de GHL. Port del nodo
 * "Procesar Último Mensaje" de n8n: detecta canal, tipo de adjunto,
 * valida y devuelve si es procesable.
 */

/**
 * Por qué un mensaje no se pudo procesar. Distingue los casos donde todavía
 * podemos recuperarnos leyendo la conversación (`sin_mensajes`, `sin_inbound`)
 * de los que son definitivos (adjunto no soportado, mensaje vacío).
 */
export type UnprocessableReason =
  | 'sin_mensajes'
  | 'sin_inbound'
  | 'vacio'
  | 'muy_largo'
  | 'no_soportado';

/** Motivos donde el cuerpo de la conversación sirve como respaldo. */
export function esRecuperable(reason?: UnprocessableReason): boolean {
  return reason === 'sin_mensajes' || reason === 'sin_inbound';
}

export type ProcessedMessage = {
  procesable: boolean;
  errorMessage?: string;
  reason?: UnprocessableReason;
  message?: string;
  messageType: 'text' | 'image' | 'audio' | 'error';
  attachmentUrl?: string;
  conversationId?: string;
  ghlMessageId?: string;
  /** null cuando no se pudo determinar. Nunca se adivina un canal. */
  inboundChannel: string | null;
};

/**
 * Traduce el tipo de mensaje de GHL a un canal de envío.
 *
 * Devuelve null si no reconoce el tipo. Antes caía en 'WhatsApp' por
 * defecto, y eso hacía que un SMS se contestara por WhatsApp — donde, sin
 * una ventana de 24h abierta, el mensaje nunca llega.
 */
export function mapMessageTypeToChannel(
  msgType?: string,
  numericType?: number,
): string | null {
  const mt = (msgType || '').toUpperCase();
  const nt = Number(numericType);
  if (mt === 'TYPE_WHATSAPP') return 'WhatsApp';
  if (mt === 'TYPE_SMS') return 'SMS';
  if (mt === 'TYPE_EMAIL') return 'Email';
  if (mt === 'TYPE_FACEBOOK') return 'FB';
  if (mt === 'TYPE_INSTAGRAM') return 'IG';
  if (mt === 'TYPE_LIVE_CHAT') return 'Live_Chat';
  if (mt === 'TYPE_CUSTOM_SMS') return 'SMS';
  if (mt === 'TYPE_CUSTOM_EMAIL') return 'Email';
  if (mt === 'TYPE_GMB') return 'GMB';
  if (nt === 1) return 'SMS';
  if (nt === 3) return 'Email';
  if (nt === 11) return 'FB';
  if (nt === 15) return 'GMB';
  if (nt === 18) return 'IG';
  if (nt === 19) return 'WhatsApp';
  if (nt === 20) return 'SMS';
  if (nt === 21) return 'Email';
  if (nt === 29) return 'Live_Chat';
  return null;
}

function detectAttachmentType(url: string): 'image' | 'audio' | 'video' | 'document' | 'unknown' {
  if (!url) return 'unknown';
  const cleanUrl = url.toString().split('?')[0].toLowerCase();
  const ext = cleanUrl.split('.').pop() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'opus', 'aac', 'flac', 'webm'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'avi', 'mkv', '3gp'].includes(ext)) return 'video';
  if (['pdf', 'docx', 'doc', 'txt', 'xlsx', 'xls'].includes(ext)) return 'document';
  return 'unknown';
}

function toMillis(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Ordena de más nuevo a más viejo. GHL suele devolverlos así, pero nada lo
 * garantiza: sin ordenar, "el primer inbound del array" puede ser un mensaje
 * de hace días y el bot contesta a destiempo.
 */
function masRecientesPrimero(messages: GhlMessage[]): GhlMessage[] {
  return [...messages].sort((a, b) => toMillis(b.dateAdded) - toMillis(a.dateAdded));
}

/**
 * @param messages Últimos mensajes de la conversación.
 * @param canalConversacion Canal deducido de la conversación, usado como
 *   respaldo cuando el mensaje no permite determinarlo.
 */
export function processLastMessage(
  messages: GhlMessage[],
  canalConversacion: string | null = null,
): ProcessedMessage {
  if (!messages || messages.length === 0) {
    return unsupported(
      'No pude encontrar tu mensaje en el sistema. Por favor escribime de nuevo.',
      canalConversacion,
      'sin_mensajes',
    );
  }

  const lastMsg = masRecientesPrimero(messages).find((m) => m.direction === 'inbound');
  if (!lastMsg) {
    return unsupported(
      'No encontré mensajes nuevos tuyos. Si querés escribir, por favor enviame tu consulta de nuevo.',
      canalConversacion,
      'sin_inbound',
    );
  }

  const inboundChannel =
    mapMessageTypeToChannel(lastMsg.messageType, lastMsg.type) ?? canalConversacion;
  const body = (lastMsg.body || '').toString();
  const attachments = Array.isArray(lastMsg.attachments) ? lastMsg.attachments : [];

  let messageType: ProcessedMessage['messageType'] = 'text';
  let attachmentUrl = '';

  if (attachments.length > 0) {
    const first = attachments[0];
    attachmentUrl =
      typeof first === 'string' ? first : first?.url || first?.fileUrl || '';
    const detected = detectAttachmentType(attachmentUrl);
    if (detected === 'image' || detected === 'audio') {
      messageType = detected;
    } else if (detected === 'video') {
      return unsupported(
        'Por el momento no puedo procesar videos. Si querés contarme con palabras o un audio de qué se trata, con gusto te ayudo.',
        inboundChannel,
        'no_soportado',
      );
    } else if (detected === 'document') {
      return unsupported(
        'Por el momento no puedo procesar documentos PDF u otros archivos. Si querés contarme con palabras de qué se trata, con gusto te ayudo.',
        inboundChannel,
        'no_soportado',
      );
    } else {
      return unsupported(
        'Por el momento solo puedo procesar texto, imágenes y audios. Si querés contarme con palabras de qué se trata, con gusto te ayudo.',
        inboundChannel,
        'no_soportado',
      );
    }
  }

  if (!body && !attachmentUrl) {
    return unsupported(
      'Tu mensaje llegó vacío. Por favor escribime de nuevo.',
      inboundChannel,
      'vacio',
    );
  }
  if (body.length > 2000) {
    return unsupported(
      'Tu mensaje es muy largo. Por favor enviame uno más corto (máximo 2000 caracteres).',
      inboundChannel,
      'muy_largo',
    );
  }

  const cleanBody = body.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();

  return {
    procesable: true,
    message: cleanBody,
    messageType,
    attachmentUrl,
    conversationId: lastMsg.conversationId || '',
    ghlMessageId: lastMsg.id || '',
    inboundChannel,
  };
}

function unsupported(
  errorMessage: string,
  inboundChannel: string | null,
  reason: UnprocessableReason,
): ProcessedMessage {
  return { procesable: false, errorMessage, reason, messageType: 'error', inboundChannel };
}
