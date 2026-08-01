import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireUser, applyPromptChange, estado } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  applyPromptChange: vi.fn(),
  estado: { reglasAprobadas: [] as Record<string, unknown>[] },
}));

vi.mock('@/lib/api-auth', () => ({ requireUser }));
vi.mock('@/lib/prompt-versions', () => ({
  applyPromptChange,
  restoreVersion: vi.fn(),
  listVersions: vi.fn(),
}));
vi.mock('@/lib/error-log', () => ({ logWorkflowError: vi.fn(async () => {}) }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(tabla: string) {
      if (tabla !== 'nlcn_learned_rules') throw new Error(`tabla inesperada: ${tabla}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ in: async () => ({ data: estado.reglasAprobadas, error: null }) }),
          }),
        }),
      };
    },
  }),
}));

import { POST } from './route';

function req(body: unknown): Request {
  return new Request('http://t/api/prompts/ventas/apply', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ agentKey: 'ventas' }) });

beforeEach(() => {
  estado.reglasAprobadas = [{ id: 1 }, { id: 2 }];
  applyPromptChange.mockReset();
  applyPromptChange.mockResolvedValue({ versionId: 9, versionNumber: 3 });
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { email: 'ale@bralto.io' }, error: null });
});

describe('POST /api/prompts/[agentKey]/apply', () => {
  it('aplica el cambio y devuelve la versión creada', async () => {
    const res = await POST(req({ systemPrompt: 'PROMPT NUEVO', ruleIds: [1, 2] }), ctx());
    const body = await res.json();

    expect(body).toEqual({ ok: true, versionId: 9, versionNumber: 3 });
    expect(applyPromptChange).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: 'ventas',
        systemPrompt: 'PROMPT NUEVO',
        ruleIds: [1, 2],
      }),
    );
  });

  it('rechaza un agente que no existe', async () => {
    const res = await POST(req({ systemPrompt: 'P', ruleIds: [1] }), {
      params: Promise.resolve({ agentKey: 'recepcion' }),
    });

    expect(res.status).toBe(400);
    expect(applyPromptChange).not.toHaveBeenCalled();
  });

  it('rechaza un prompt vacío', async () => {
    const res = await POST(req({ systemPrompt: '   ', ruleIds: [1] }), ctx());

    expect(res.status).toBe(400);
    expect(applyPromptChange).not.toHaveBeenCalled();
  });

  it('rechaza si alguna regla enviada ya no está aprobada', async () => {
    // La regla 2 fue rechazada por otra persona mientras se veía el diff.
    estado.reglasAprobadas = [{ id: 1 }];

    const res = await POST(req({ systemPrompt: 'P', ruleIds: [1, 2] }), ctx());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/cambiaron/i);
    expect(applyPromptChange).not.toHaveBeenCalled();
  });

  it('rechaza sin sesión', async () => {
    requireUser.mockResolvedValue({
      user: null,
      error: new Response('No autorizado', { status: 401 }),
    });

    const res = await POST(req({ systemPrompt: 'P', ruleIds: [1] }), ctx());

    expect(res.status).toBe(401);
  });

  it('devuelve 500 si la aplicación atómica falla', async () => {
    applyPromptChange.mockRejectedValue(new Error('deadlock'));

    const res = await POST(req({ systemPrompt: 'P', ruleIds: [1, 2] }), ctx());

    expect(res.status).toBe(500);
  });
});
