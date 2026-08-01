import { describe, it, expect, vi, beforeEach } from 'vitest';

const { scanAndSummarize, requireUser } = vi.hoisted(() => ({
  scanAndSummarize: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock('@/lib/review-scan', () => ({ scanAndSummarize }));
vi.mock('@/lib/api-auth', () => ({ requireUser }));
vi.mock('@/lib/error-log', () => ({ logWorkflowError: vi.fn(async () => {}) }));

import { POST } from './route';

beforeEach(() => {
  scanAndSummarize.mockReset();
  scanAndSummarize.mockResolvedValue({ candidatos: 1, creados: 1, fallidos: 0 });
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { email: 'x@y.com' }, error: null });
});

describe('POST /api/reviews/refresh', () => {
  it('corre el barrido para un usuario autenticado', async () => {
    const res = await POST();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.creados).toBe(1);
  });

  it('rechaza si no hay sesión', async () => {
    requireUser.mockResolvedValue({
      user: null,
      error: new Response('No autorizado', { status: 401 }),
    });

    const res = await POST();

    expect(res.status).toBe(401);
    expect(scanAndSummarize).not.toHaveBeenCalled();
  });
});
