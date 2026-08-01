import { describe, it, expect } from 'vitest';
import { CHATBOT_FALLBACK_MESSAGE } from '@/lib/review-constants';
import {
  splitIntoEpisodes,
  detectSignals,
  signalWeight,
  type ChatbotLog,
} from './conversation-episodes';

/** Construye un log con valores por defecto sanos. */
function log(partial: Partial<ChatbotLog> & { id: number; created_at: string }): ChatbotLog {
  return {
    phone: '+50688887777',
    contact_id: 'c1',
    message_in: 'hola',
    message_out: 'buenas',
    has_reservation: false,
    agente_usado: 'soporte',
    transferir_a_ventas: false,
    ...partial,
  };
}

describe('splitIntoEpisodes', () => {
  it('mensajes seguidos forman un solo episodio', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T10:05:00Z' }),
      log({ id: 3, created_at: '2026-07-01T10:20:00Z' }),
    ]);

    expect(eps).toHaveLength(1);
    expect(eps[0].turn_count).toBe(3);
    expect(eps[0].window_start).toBe('2026-07-01T10:00:00Z');
    expect(eps[0].window_end).toBe('2026-07-01T10:20:00Z');
  });

  it('un hueco de 7 horas parte la conversación en dos episodios', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T17:00:00Z' }),
    ]);

    expect(eps).toHaveLength(2);
    expect(eps[0].turn_count).toBe(1);
    expect(eps[1].turn_count).toBe(1);
  });

  it('un hueco de exactamente 6 horas ya cierra el episodio', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T16:00:00Z' }),
    ]);

    expect(eps).toHaveLength(2);
  });

  it('un hueco de 5h59m NO cierra el episodio', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T15:59:00Z' }),
    ]);

    expect(eps).toHaveLength(1);
  });

  it('una conversación de un solo mensaje es un episodio válido', () => {
    const eps = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    expect(eps).toHaveLength(1);
    expect(eps[0].turn_count).toBe(1);
    expect(eps[0].window_start).toBe(eps[0].window_end);
  });

  it('dos agentes con el mismo teléfono producen episodios separados', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: 'soporte' }),
      log({ id: 2, created_at: '2026-07-01T10:02:00Z', agente_usado: 'ventas' }),
    ]);

    expect(eps).toHaveLength(2);
    expect(eps.map((e) => e.agente).sort()).toEqual(['soporte', 'ventas']);
  });

  it('dos teléfonos distintos producen episodios separados', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', phone: '+50611111111' }),
      log({ id: 2, created_at: '2026-07-01T10:02:00Z', phone: '+50622222222' }),
    ]);

    expect(eps).toHaveLength(2);
  });

  it('ordena logs desordenados antes de agrupar', () => {
    const eps = splitIntoEpisodes([
      log({ id: 3, created_at: '2026-07-01T10:20:00Z' }),
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T10:05:00Z' }),
    ]);

    expect(eps).toHaveLength(1);
    expect(eps[0].logs.map((l) => l.id)).toEqual([1, 2, 3]);
  });

  it('un agente nulo se agrupa como "desconocido" sin perder el log', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: null }),
    ]);

    expect(eps).toHaveLength(1);
    expect(eps[0].agente).toBe('desconocido');
  });

  it('respeta un umbral de horas personalizado', () => {
    const logs = [
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T12:00:00Z' }),
    ];

    expect(splitIntoEpisodes(logs, 6)).toHaveLength(1);
    expect(splitIntoEpisodes(logs, 1)).toHaveLength(2);
  });

  it('una lista vacía devuelve una lista vacía', () => {
    expect(splitIntoEpisodes([])).toEqual([]);
  });
});

describe('detectSignals', () => {
  it('detecta escalamiento a humano', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: 'escalamiento' }),
    ]);
    expect(señales).toContain('escalamiento');
  });

  it('detecta el mensaje de error del bot por la constante compartida', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', message_out: CHATBOT_FALLBACK_MESSAGE }),
    ]);
    expect(señales).toContain('error_bot');
  });

  it('detecta mensaje no procesable', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: 'sistema' }),
    ]);
    expect(señales).toContain('no_procesable');
  });

  it('detecta derivación a ventas', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', transferir_a_ventas: true }),
    ]);
    expect(señales).toContain('derivado_ventas');
  });

  it('marca conversación larga a partir de 8 turnos', () => {
    const ocho = Array.from({ length: 8 }, (_, i) =>
      log({ id: i + 1, created_at: `2026-07-01T10:0${i}:00Z` }),
    );
    expect(detectSignals(ocho)).toContain('conversacion_larga');

    const siete = ocho.slice(0, 7);
    expect(detectSignals(siete)).not.toContain('conversacion_larga');
  });

  it('una conversación normal no dispara ninguna señal', () => {
    expect(detectSignals([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })])).toEqual([]);
  });

  it('no repite una señal que aparece en varios turnos', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', transferir_a_ventas: true }),
      log({ id: 2, created_at: '2026-07-01T10:01:00Z', transferir_a_ventas: true }),
    ]);
    expect(señales.filter((s) => s === 'derivado_ventas')).toHaveLength(1);
  });
});

describe('signalWeight', () => {
  it('suma los pesos de las señales', () => {
    // escalamiento (40) + derivado_ventas (20)
    expect(signalWeight(['escalamiento', 'derivado_ventas'])).toBe(60);
  });

  it('sin señales el peso es cero', () => {
    expect(signalWeight([])).toBe(0);
  });
});

describe('integración: el episodio trae sus señales calculadas', () => {
  it('adjunta señales y peso a cada episodio', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: 'escalamiento' }),
    ]);

    expect(eps[0].signals).toEqual(['escalamiento']);
    expect(eps[0].signal_weight).toBe(40);
  });
});
