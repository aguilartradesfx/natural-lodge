import type { GhlMessage } from '@/lib/ghl';

/**
 * Procesa el último mensaje inbound de GHL. Port del nodo
 * "Procesar Último Mensaje" de n8n: detecta canal, tipo de adjunto,
 * valida y devuelve si es procesable.
 */

export type ProcessedMessage = {
  procesable: boolean;
  errorMessage?: string;
  message?: string;
  messageType: 'text' | 'image' | 'audio' | 'error';
  attachmentUrl?: string;
  conversationId?: string;
  ghlMessageId?: string;
  inboundChannel: string;
};

export function mapMessageTypeToChannel(msgType?: string, numericType?: number): string {
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
  return 'WhatsApp';
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

export function processLastMessage(messages: GhlMessage[]): ProcessedMessage {
  if (!messages || messages.length === 0) {
    return {
      procesable: false,
      errorMessage: 'No pude encontrar tu mensaje en el sistema. Por favor escribime de nuevo.',
      messageType: 'error',
      inboundChannel: 'WhatsApp',
    };
  }

  const lastMsg = messages.find((m) => m.direction === 'inbound');
  if (!lastMsg) {
    return {
      procesable: false,
      errorMessage:
        'No encontré mensajes nuevos tuyos. Si querés escribir, por favor enviame tu consulta de nuevo.',
      messageType: 'error',
      inboundChannel: 'WhatsApp',
    };
  }

  const inboundChannel = mapMessageTypeToChannel(lastMsg.messageType, lastMsg.type);
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
      );
    } else if (detected === 'document') {
      return unsupported(
        'Por el momento no puedo procesar documentos PDF u otros archivos. Si querés contarme con palabras de qué se trata, con gusto te ayudo.',
        inboundChannel,
      );
    } else {
      return unsupported(
        'Por el momento solo puedo procesar texto, imágenes y audios. Si querés contarme con palabras de qué se trata, con gusto te ayudo.',
        inboundChannel,
      );
    }
  }

  if (!body && !attachmentUrl) {
    return unsupported('Tu mensaje llegó vacío. Por favor escribime de nuevo.', inboundChannel);
  }
  if (body.length > 2000) {
    return unsupported(
      'Tu mensaje es muy largo. Por favor enviame uno más corto (máximo 2000 caracteres).',
      inboundChannel,
    );
  }

  // eslint-disable-next-line no-control-regex
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

function unsupported(errorMessage: string, inboundChannel: string): ProcessedMessage {
  return { procesable: false, errorMessage, messageType: 'error', inboundChannel };
}
