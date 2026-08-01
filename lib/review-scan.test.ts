import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: el factory de vi.mock se eleva por encima de las declaraciones
// del módulo, así que los mocks no pueden cerrar sobre un `const` normal.
const { summarizeEpisode, logWorkflowError, estado } = vi.hoisted(() => ({
  summarizeEpisode: vi.fn(),
  logWorkflowError: vi.fn(async () => {}),
  estado: {
    logsData: [] as unknown[],
    existentes: [] as { phone: string; agente: string; window_end: string }[],
    insertados: [] as Record<string, unknown>[],
    insertFalla: false,
  },
}));

vi.mock('@/lib/review-summary', () => ({ summarizeEpisode }));
vi.mock('@/lib/error-log', () => ({ logWorkflowError }));

/**
 * Doble de Supabase mínimo: solo las cadenas que usa review-scan.
 */
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(tabla: string) {
      if (tabla === 'chatbot_logs') {
        return {
          select: () => ({
            lte: () => ({
              gte: () => ({
                order: async () => ({ data: estado.logsData, error: null }),
              }),
            }),
          }),
        };
      }
      if (tabla === 'nlcn_conversation_reviews') {
        return {
          select: () => ({ gte: async () => ({ data: estado.existentes, error: null }) }),
          insert: async (fila: Record<string, unknown>) => {
            if (estado.insertFalla) return { error: { message: 'insert falló' } };
            estado.insertados.push(fila);
            return { error: null };
          },
        };
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    },
  }),
}));

import { scanAndSummarize } from './review-scan';

const RESUMEN = { summary: 'resumen', topics: ['t'], outcome: 'resuelto', risk_score: 10 };

function log(id: number, created_at: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    phone: '+50688887777',
    contact_id: 'c1',
    message_in: 'hola',
    message_out: 'buenas',
    has_reservation: false,
    agente_usado: 'soporte',
    transferir_a_ventas: false,
    created_at,
    ...extra,
  };
}

beforeEach(() => {
  estado.logsData = [];
  estado.existentes = [];
  estado.insertados = [];
  estado.insertFalla = false;
  summarizeEpisode.mockReset();
  summarizeEpisode.mockResolvedValue(RESUMEN);
  logWorkflowError.mockClear();
});

describe('scanAndSummarize', () => {
  it('resume y guarda un episodio pendiente', async () => {
    estado.logsData = [log(1, '2026-07-01T10:00:00Z'), log(2, '2026-07-01T10:05:00Z')];

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res).toEqual({ candidatos: 1, creados: 1, fallidos: 0 });
    expect(estado.insertados).toHaveLength(1);
    expect(estado.insertados[0].phone).toBe('+50688887777');
    expect(estado.insertados[0].turn_count).toBe(2);
    expect(estado.insertados[0].summary).toBe('resumen');
    expect(estado.insertados[0].status).toBe('pendiente');
  });

  it('la prioridad suma el peso de las señales y el risk_score', async () => {
    estado.logsData = [log(1, '2026-07-01T10:00:00Z', { agente_usado: 'escalamiento' })];
    summarizeEpisode.mockResolvedValue({ ...RESUMEN, risk_score: 30 });

    await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    // escalamiento (40) + risk_score (30)
    expect(estado.insertados[0].priority).toBe(70);
  });

  it('salta los episodios que ya tienen revisión (idempotencia)', async () => {
    estado.logsData = [log(1, '2026-07-01T10:00:00Z')];
    estado.existentes = [
      { phone: '+50688887777', agente: 'soporte', window_end: '2026-07-01T10:00:00Z' },
    ];

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res).toEqual({ candidatos: 0, creados: 0, fallidos: 0 });
    expect(summarizeEpisode).not.toHaveBeenCalled();
  });

  it('compara la ventana por instante, no por el string exacto', async () => {
    estado.logsData = [log(1, '2026-07-01T10:00:00Z')];
    // Postgres devuelve el timestamptz con otro formato que el log original.
    estado.existentes = [
      { phone: '+50688887777', agente: 'soporte', window_end: '2026-07-01T10:00:00+00:00' },
    ];

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res.candidatos).toBe(0);
  });

  it('respeta el tope de episodios por corrida', async () => {
    estado.logsData = [
      log(1, '2026-07-01T10:00:00Z', { phone: '+1' }),
      log(2, '2026-07-01T10:00:00Z', { phone: '+2' }),
      log(3, '2026-07-01T10:00:00Z', { phone: '+3' }),
    ];

    const res = await scanAndSummarize({ batchSize: 2, now: new Date('2026-07-02T00:00:00Z') });

    expect(res.candidatos).toBe(3);
    expect(res.creados).toBe(2);
    expect(estado.insertados).toHaveLength(2);
  });

  it('prioriza los episodios con más señales cuando hay tope', async () => {
    estado.logsData = [
      log(1, '2026-07-01T10:00:00Z', { phone: '+1' }),
      log(2, '2026-07-01T10:00:00Z', { phone: '+2', agente_usado: 'escalamiento' }),
    ];

    await scanAndSummarize({ batchSize: 1, now: new Date('2026-07-02T00:00:00Z') });

    expect(estado.insertados[0].phone).toBe('+2');
  });

  it('un episodio que falla no detiene a los demás', async () => {
    estado.logsData = [
      log(1, '2026-07-01T10:00:00Z', { phone: '+1' }),
      log(2, '2026-07-01T10:00:00Z', { phone: '+2' }),
    ];
    summarizeEpisode
      .mockRejectedValueOnce(new Error('529 overloaded'))
      .mockResolvedValueOnce(RESUMEN);

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res.creados).toBe(1);
    expect(res.fallidos).toBe(1);
    expect(logWorkflowError).toHaveBeenCalledTimes(1);
  });

  it('un insert fallido cuenta como fallido y se registra', async () => {
    estado.logsData = [log(1, '2026-07-01T10:00:00Z')];
    estado.insertFalla = true;

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res).toEqual({ candidatos: 1, creados: 0, fallidos: 1 });
    expect(logWorkflowError).toHaveBeenCalledTimes(1);
  });

  it('sin logs no hace nada', async () => {
    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res).toEqual({ candidatos: 0, creados: 0, fallidos: 0 });
    expect(summarizeEpisode).not.toHaveBeenCalled();
  });
});
