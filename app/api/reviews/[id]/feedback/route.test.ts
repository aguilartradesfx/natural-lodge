import { describe, it, expect, vi, beforeEach } from 'vitest';

type FeedbackInput = {
  reviewId: number;
  rating: string;
  comment: string;
  anchors: { chatbot_log_id: number; verdict: string; comment: string | null }[];
  userEmail: string;
};

const { saveFeedback, generateRuleForReview, requireUser } = vi.hoisted(() => ({
  // Tipar el parámetro deja que los tests inspeccionen `mock.calls[0][0]`.
  saveFeedback: vi.fn(async (_input: unknown) => {}),
  generateRuleForReview: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock('@/lib/reviews', () => ({ saveFeedback, generateRuleForReview }));
vi.mock('@/lib/api-auth', () => ({ requireUser }));
vi.mock('@/lib/error-log', () => ({ logWorkflowError: vi.fn(async () => {}) }));

import { POST } from './route';

const REGLA = { id: 77, agent_key: 'ventas', kind: 'nueva', status: 'propuesta' };

function req(body: unknown): Request {
  return new Request('http://t/api/reviews/5/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ id: '5' }) });

beforeEach(() => {
  saveFeedback.mockClear();
  saveFeedback.mockResolvedValue(undefined);
  generateRuleForReview.mockReset();
  generateRuleForReview.mockResolvedValue(REGLA);
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { email: 'ale@bralto.io' }, error: null });
});

describe('POST /api/reviews/[id]/feedback', () => {
  it('guarda el feedback y devuelve la regla generada', async () => {
    const res = await POST(
      req({ rating: 'mal', comment: 'perdimos una venta', anchors: [] }),
      ctx(),
    );
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.rule.id).toBe(77);
    expect(saveFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 5, rating: 'mal', userEmail: 'ale@bralto.io' }),
    );
  });

  it('rechaza sin sesión', async () => {
    requireUser.mockResolvedValue({
      user: null,
      error: new Response('No autorizado', { status: 401 }),
    });

    const res = await POST(req({ rating: 'mal' }), ctx());

    expect(res.status).toBe(401);
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it('rechaza una calificación inválida', async () => {
    const res = await POST(req({ rating: 'excelente' }), ctx());

    expect(res.status).toBe(400);
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it('rechaza un id no numérico', async () => {
    const res = await POST(req({ rating: 'bien' }), { params: Promise.resolve({ id: 'abc' }) });

    expect(res.status).toBe(400);
  });

  it('si la IA falla, el feedback IGUAL queda guardado', async () => {
    generateRuleForReview.mockRejectedValue(new Error('529 overloaded'));

    const res = await POST(req({ rating: 'mal', comment: 'x', anchors: [] }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rule).toBeNull();
    expect(body.ruleError).toMatch(/no se pudo generar/i);
    expect(saveFeedback).toHaveBeenCalledTimes(1);
  });

  it('devuelve 500 si falla el guardado del feedback', async () => {
    saveFeedback.mockRejectedValueOnce(new Error('db caída'));

    const res = await POST(req({ rating: 'bien' }), ctx());

    expect(res.status).toBe(500);
  });

  it('normaliza los anclajes descartando los que no traen log válido', async () => {
    await POST(
      req({
        rating: 'mal',
        comment: '',
        anchors: [
          { chatbot_log_id: 1, verdict: 'mal', comment: 'acá' },
          { chatbot_log_id: 'x', verdict: 'mal', comment: null },
          { chatbot_log_id: 2, verdict: 'inventado', comment: null },
        ],
      }),
      ctx(),
    );

    expect((saveFeedback.mock.calls[0][0] as FeedbackInput).anchors).toEqual([
      { chatbot_log_id: 1, verdict: 'mal', comment: 'acá' },
    ]);
  });
});
