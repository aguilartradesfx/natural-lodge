import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: el factory de vi.mock se eleva por encima de las declaraciones
// del módulo, así que el mock no puede cerrar sobre un `const` normal.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create } },
  ANTHROPIC_REVIEW_MODEL: 'claude-sonnet-5',
}));

import { splitIntoEpisodes, type ChatbotLog } from './conversation-episodes';
import { buildTranscript, summarizeEpisode } from './review-summary';

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

function respuesta(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

const PAYLOAD_OK = {
  summary: 'El huésped preguntó por el check-in.',
  topics: ['check-in'],
  outcome: 'resuelto',
  risk_score: 10,
};

beforeEach(() => {
  create.mockReset();
});

describe('buildTranscript', () => {
  it('numera los turnos y marca quién habló', () => {
    const t = buildTranscript([
      log({
        id: 7,
        created_at: '2026-07-01T10:00:00Z',
        message_in: '¿a qué hora es el check-in?',
        message_out: 'A las 2 p.m.',
      }),
    ]);

    expect(t).toContain('[turno 1 · log 7]');
    expect(t).toContain('Huésped: ¿a qué hora es el check-in?');
    expect(t).toContain('Bot: A las 2 p.m.');
  });

  it('omite las líneas vacías en vez de escribir "null"', () => {
    const t = buildTranscript([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', message_in: '', message_out: 'solo bot' }),
    ]);

    expect(t).not.toContain('Huésped:');
    expect(t).toContain('Bot: solo bot');
  });
});

describe('summarizeEpisode', () => {
  it('devuelve el resumen estructurado', async () => {
    create.mockResolvedValue(respuesta(PAYLOAD_OK));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    const res = await summarizeEpisode(ep);

    expect(res.summary).toBe('El huésped preguntó por el check-in.');
    expect(res.topics).toEqual(['check-in']);
    expect(res.outcome).toBe('resuelto');
    expect(res.risk_score).toBe(10);
  });

  it('usa el modelo de revisión y pide salida estructurada', async () => {
    create.mockResolvedValue(respuesta(PAYLOAD_OK));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    await summarizeEpisode(ep);

    const args = create.mock.calls[0][0];
    expect(args.model).toBe('claude-sonnet-5');
    expect(args.output_config.format.type).toBe('json_schema');
    expect(args.output_config.effort).toBe('low');
  });

  it('incluye el transcript y las señales detectadas en el prompt', async () => {
    create.mockResolvedValue(respuesta(PAYLOAD_OK));
    const [ep] = splitIntoEpisodes([
      log({
        id: 1,
        created_at: '2026-07-01T10:00:00Z',
        message_in: 'quiero cancelar',
        agente_usado: 'escalamiento',
      }),
    ]);

    await summarizeEpisode(ep);

    const contenido = create.mock.calls[0][0].messages[0].content as string;
    expect(contenido).toContain('quiero cancelar');
    expect(contenido).toContain('escalamiento');
  });

  it('acota risk_score al rango 0-100 aunque el modelo se pase', async () => {
    create.mockResolvedValue(respuesta({ ...PAYLOAD_OK, risk_score: 950 }));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    expect((await summarizeEpisode(ep)).risk_score).toBe(100);
  });

  it('cae a "indeterminado" si el outcome no es uno de los válidos', async () => {
    create.mockResolvedValue(respuesta({ ...PAYLOAD_OK, outcome: 'cualquier-cosa' }));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    expect((await summarizeEpisode(ep)).outcome).toBe('indeterminado');
  });

  it('propaga el error si Claude falla — el barrido decide qué hacer', async () => {
    create.mockRejectedValue(new Error('529 overloaded'));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    await expect(summarizeEpisode(ep)).rejects.toThrow('529 overloaded');
  });

  it('lanza si la respuesta no trae bloque de texto', async () => {
    create.mockResolvedValue({ content: [] });
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    await expect(summarizeEpisode(ep)).rejects.toThrow(/respuesta vacía/i);
  });
});
