import { describe, it, expect } from 'vitest';
import {
  mapMessageTypeToChannel,
  processLastMessage,
  esRecuperable,
} from './chatbot-message';
import type { GhlMessage } from './ghl';

const inbound = (extra: Partial<GhlMessage> = {}): GhlMessage => ({
  id: 'msg_1',
  conversationId: 'conv_1',
  direction: 'inbound',
  body: 'hola',
  ...extra,
});

describe('mapMessageTypeToChannel', () => {
  it('traduce los tipos con nombre', () => {
    expect(mapMessageTypeToChannel('TYPE_SMS')).toBe('SMS');
    expect(mapMessageTypeToChannel('TYPE_INSTAGRAM')).toBe('IG');
    expect(mapMessageTypeToChannel('TYPE_WHATSAPP')).toBe('WhatsApp');
  });

  it('traduce los tipos numéricos', () => {
    expect(mapMessageTypeToChannel(undefined, 1)).toBe('SMS');
    expect(mapMessageTypeToChannel(undefined, 19)).toBe('WhatsApp');
  });

  it('devuelve null cuando no reconoce el tipo, en vez de asumir WhatsApp', () => {
    // El default a WhatsApp hacía que un SMS se contestara por WhatsApp, donde
    // sin ventana de 24h el mensaje nunca llega.
    expect(mapMessageTypeToChannel('TYPE_ALGO_NUEVO')).toBeNull();
    expect(mapMessageTypeToChannel(undefined, 999)).toBeNull();
    expect(mapMessageTypeToChannel()).toBeNull();
  });
});

describe('processLastMessage — canal', () => {
  it('usa el canal del mensaje', () => {
    const r = processLastMessage([inbound({ messageType: 'TYPE_SMS' })]);
    expect(r.procesable).toBe(true);
    expect(r.inboundChannel).toBe('SMS');
  });

  it('cae al canal de la conversación si el mensaje no lo dice', () => {
    const r = processLastMessage([inbound({ messageType: 'TYPE_DESCONOCIDO' })], 'SMS');
    expect(r.inboundChannel).toBe('SMS');
  });

  it('deja el canal en null si ninguna fuente lo sabe', () => {
    const r = processLastMessage([inbound({ messageType: 'TYPE_DESCONOCIDO' })]);
    expect(r.inboundChannel).toBeNull();
  });

  it('propaga el canal de la conversación a los mensajes de error', () => {
    const r = processLastMessage([], 'SMS');
    expect(r.procesable).toBe(false);
    expect(r.inboundChannel).toBe('SMS');
  });

  it('sin mensajes ni canal conocido no inventa uno', () => {
    const r = processLastMessage([]);
    expect(r.inboundChannel).toBeNull();
  });
});

describe('processLastMessage — orden de los mensajes', () => {
  it('toma el inbound más reciente aunque el array venga al revés', () => {
    // GHL suele devolver de más nuevo a más viejo, pero nada lo garantiza:
    // sin ordenar, el bot contestaba un mensaje de hace días.
    const r = processLastMessage([
      inbound({ id: 'viejo', body: 'mensaje viejo', dateAdded: '2026-08-01T10:00:00Z' }),
      inbound({ id: 'nuevo', body: 'mensaje nuevo', dateAdded: '2026-08-08T10:00:00Z' }),
    ]);
    expect(r.message).toBe('mensaje nuevo');
    expect(r.ghlMessageId).toBe('nuevo');
  });

  it('ignora los outbound', () => {
    const r = processLastMessage([
      { id: 'bot', direction: 'outbound', body: 'respuesta', dateAdded: '2026-08-08T11:00:00Z' },
      inbound({ id: 'huesped', body: 'pregunta', dateAdded: '2026-08-08T10:00:00Z' }),
    ]);
    expect(r.ghlMessageId).toBe('huesped');
  });
});

describe('processLastMessage — motivos', () => {
  it('marca como recuperable cuando no hay mensajes', () => {
    expect(esRecuperable(processLastMessage([]).reason)).toBe(true);
  });

  it('marca como recuperable cuando no hay ningún inbound', () => {
    const r = processLastMessage([{ direction: 'outbound', body: 'hola' }]);
    expect(esRecuperable(r.reason)).toBe(true);
  });

  it('un adjunto no soportado NO es recuperable', () => {
    // Reintentar la lectura no va a convertir un PDF en algo procesable.
    const r = processLastMessage([
      inbound({ messageType: 'TYPE_SMS', attachments: ['https://x.com/a.pdf'] }),
    ]);
    expect(r.procesable).toBe(false);
    expect(esRecuperable(r.reason)).toBe(false);
  });

  it('un mensaje muy largo NO es recuperable', () => {
    const r = processLastMessage([inbound({ body: 'x'.repeat(2001) })]);
    expect(r.reason).toBe('muy_largo');
    expect(esRecuperable(r.reason)).toBe(false);
  });
});

describe('processLastMessage — adjuntos', () => {
  it('detecta imágenes', () => {
    const r = processLastMessage([
      inbound({ body: '', attachments: [{ url: 'https://x.com/foto.jpg?token=1' }] }),
    ]);
    expect(r.procesable).toBe(true);
    expect(r.messageType).toBe('image');
  });

  it('detecta audios', () => {
    const r = processLastMessage([inbound({ body: '', attachments: ['https://x.com/a.ogg'] })]);
    expect(r.messageType).toBe('audio');
  });
});
