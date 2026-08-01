import { describe, it, expect, vi, beforeEach } from 'vitest';

const { draftRuleFromFeedback, db, escrituras } = vi.hoisted(() => ({
  draftRuleFromFeedback: vi.fn(),
  db: {
    review: null as Record<string, unknown> | null,
    logs: [] as Record<string, unknown>[],
    anchors: [] as Record<string, unknown>[],
    rules: [] as Record<string, unknown>[],
    prompt: null as Record<string, unknown> | null,
    lista: [] as Record<string, unknown>[],
  },
  escrituras: {
    reviewUpdate: null as Record<string, unknown> | null,
    anchorsBorrados: 0,
    anchorsInsertados: [] as Record<string, unknown>[],
    reglaInsertada: null as Record<string, unknown> | null,
  },
}));

vi.mock('@/lib/learned-rules', () => ({ draftRuleFromFeedback }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(tabla: string) {
      if (tabla === 'nlcn_conversation_reviews') {
        return {
          select: () => {
            const q: Record<string, unknown> = {
              eq: () => q,
              order: () => q,
              limit: async () => ({ data: db.lista, error: null }),
              maybeSingle: async () => ({ data: db.review, error: null }),
            };
            return q;
          },
          update: (fila: Record<string, unknown>) => ({
            eq: async () => {
              escrituras.reviewUpdate = fila;
              return { error: null };
            },
          }),
        };
      }
      if (tabla === 'chatbot_logs') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: () => ({ order: async () => ({ data: db.logs, error: null }) }),
              }),
            }),
          }),
        };
      }
      if (tabla === 'nlcn_message_feedback') {
        return {
          select: () => ({ eq: async () => ({ data: db.anchors, error: null }) }),
          delete: () => ({
            eq: async () => {
              escrituras.anchorsBorrados++;
              return { error: null };
            },
          }),
          insert: async (filas: Record<string, unknown>[]) => {
            escrituras.anchorsInsertados.push(...filas);
            return { error: null };
          },
        };
      }
      if (tabla === 'nlcn_learned_rules') {
        return {
          select: () => ({ eq: () => ({ order: async () => ({ data: db.rules, error: null }) }) }),
          insert: (fila: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                escrituras.reglaInsertada = fila;
                return { data: { id: 77, ...fila }, error: null };
              },
            }),
          }),
        };
      }
      if (tabla === 'nlcn_agent_prompts') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: db.prompt, error: null }) }),
          }),
        };
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    },
  }),
}));

import { listReviews, getReviewDetail, saveFeedback, generateRuleForReview } from './reviews';

const REVIEW = {
  id: 5,
  phone: '+50688887777',
  agente: 'ventas',
  contact_id: 'c1',
  window_start: '2026-07-01T10:00:00Z',
  window_end: '2026-07-01T10:30:00Z',
  turn_count: 3,
  summary: 'El huésped preguntó cómo llegar.',
  topics: ['traslados'],
  outcome: 'sin_resolver',
  risk_score: 40,
  signals: ['derivado_ventas'],
  priority: 60,
  status: 'pendiente',
  human_rating: null,
  human_comment: null,
  reviewed_by: null,
  reviewed_at: null,
};

const LOG = {
  id: 1,
  phone: '+50688887777',
  contact_id: 'c1',
  message_in: '¿cómo llego?',
  message_out: 'Podés tomar un bus.',
  has_reservation: false,
  agente_usado: 'ventas',
  transferir_a_ventas: false,
  created_at: '2026-07-01T10:00:00Z',
};

const DRAFT = {
  kind: 'nueva',
  agent_key: 'ventas',
  trigger_text: 'preguntan cómo llegar',
  rule_text: 'Ofrecé el traslado privado.',
  rationale: 'perdimos una venta',
  conflict_excerpt: null,
};

beforeEach(() => {
  db.review = { ...REVIEW };
  db.logs = [LOG];
  db.anchors = [];
  db.rules = [];
  db.prompt = { system_prompt: 'PROMPT DE VENTAS' };
  db.lista = [REVIEW];
  escrituras.reviewUpdate = null;
  escrituras.anchorsBorrados = 0;
  escrituras.anchorsInsertados = [];
  escrituras.reglaInsertada = null;
  draftRuleFromFeedback.mockReset();
  draftRuleFromFeedback.mockResolvedValue(DRAFT);
});

describe('listReviews', () => {
  it('normaliza topics y signals', async () => {
    db.lista = [{ ...REVIEW, topics: null, signals: null }];

    const res = await listReviews();

    expect(res[0].topics).toEqual([]);
    expect(res[0].signals).toEqual([]);
  });
});

describe('getReviewDetail', () => {
  it('devuelve la revisión con sus logs, anclajes y reglas', async () => {
    db.anchors = [{ id: 1, chatbot_log_id: 1, verdict: 'mal', comment: 'acá falló' }];
    db.rules = [{ id: 9, agent_key: 'ventas', status: 'propuesta' }];

    const res = await getReviewDetail(5);

    expect(res?.review.id).toBe(5);
    expect(res?.logs).toHaveLength(1);
    expect(res?.anchors).toHaveLength(1);
    expect(res?.rules).toHaveLength(1);
  });

  it('devuelve null si la revisión no existe', async () => {
    db.review = null;
    expect(await getReviewDetail(999)).toBeNull();
  });
});

describe('saveFeedback', () => {
  it('guarda calificación, comentario y marca la revisión como revisada', async () => {
    await saveFeedback({
      reviewId: 5,
      rating: 'mal',
      comment: 'perdimos una venta',
      anchors: [],
      userEmail: 'ale@bralto.io',
    });

    expect(escrituras.reviewUpdate).toMatchObject({
      human_rating: 'mal',
      human_comment: 'perdimos una venta',
      status: 'revisada',
      reviewed_by: 'ale@bralto.io',
    });
    expect(escrituras.reviewUpdate?.reviewed_at).toEqual(expect.any(String));
  });

  it('reemplaza los anclajes previos en vez de acumularlos', async () => {
    await saveFeedback({
      reviewId: 5,
      rating: 'mal',
      comment: '',
      anchors: [{ chatbot_log_id: 1, verdict: 'mal', comment: 'acá' }],
      userEmail: 'ale@bralto.io',
    });

    expect(escrituras.anchorsBorrados).toBe(1);
    expect(escrituras.anchorsInsertados).toHaveLength(1);
    expect(escrituras.anchorsInsertados[0]).toMatchObject({
      review_id: 5,
      chatbot_log_id: 1,
      verdict: 'mal',
    });
  });

  it('sin anclajes no inserta nada pero igual limpia los viejos', async () => {
    await saveFeedback({
      reviewId: 5,
      rating: 'bien',
      comment: '',
      anchors: [],
      userEmail: 'a@b.c',
    });

    expect(escrituras.anchorsBorrados).toBe(1);
    expect(escrituras.anchorsInsertados).toHaveLength(0);
  });
});

describe('generateRuleForReview', () => {
  it('genera la regla y la guarda en estado propuesta', async () => {
    db.review = { ...REVIEW, human_comment: 'perdimos una venta' };

    const regla = await generateRuleForReview(5, 'ale@bralto.io');

    expect(regla?.id).toBe(77);
    expect(escrituras.reglaInsertada).toMatchObject({
      agent_key: 'ventas',
      source_review_id: 5,
      status: 'propuesta',
      kind: 'nueva',
      created_by: 'ale@bralto.io',
    });
  });

  it('le pasa a la IA el prompt actual del agente', async () => {
    db.review = { ...REVIEW, human_comment: 'perdimos una venta' };

    await generateRuleForReview(5, 'ale@bralto.io');

    expect(draftRuleFromFeedback.mock.calls[0][0].currentPrompt).toBe('PROMPT DE VENTAS');
  });

  it('incluye los anclajes con el texto de la respuesta marcada', async () => {
    db.review = { ...REVIEW, human_comment: 'x' };
    db.anchors = [{ id: 1, chatbot_log_id: 1, verdict: 'mal', comment: 'acá falló' }];

    await generateRuleForReview(5, 'ale@bralto.io');

    expect(draftRuleFromFeedback.mock.calls[0][0].anchors).toEqual([
      { message_out: 'Podés tomar un bus.', comment: 'acá falló' },
    ]);
  });

  it('no genera nada si no hay comentario ni anclajes', async () => {
    db.review = { ...REVIEW, human_comment: null };

    expect(await generateRuleForReview(5, 'a@b.c')).toBeNull();
    expect(draftRuleFromFeedback).not.toHaveBeenCalled();
  });

  it('devuelve null si la revisión no existe', async () => {
    db.review = null;
    expect(await generateRuleForReview(999, 'a@b.c')).toBeNull();
  });
});
