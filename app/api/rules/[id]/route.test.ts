import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireUser, estado } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  estado: {
    reglaActual: null as Record<string, unknown> | null,
    actualizacion: null as Record<string, unknown> | null,
  },
}));

vi.mock('@/lib/api-auth', () => ({ requireUser }));
vi.mock('@/lib/error-log', () => ({ logWorkflowError: vi.fn(async () => {}) }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(tabla: string) {
      if (tabla !== 'nlcn_learned_rules') throw new Error(`tabla inesperada: ${tabla}`);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: estado.reglaActual, error: null }) }),
        }),
        update: (fila: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({
              single: async () => {
                estado.actualizacion = fila;
                return { data: { ...estado.reglaActual, ...fila }, error: null };
              },
            }),
          }),
        }),
      };
    },
  }),
}));

import { PATCH } from './route';

function req(body: unknown): Request {
  return new Request('http://t/api/rules/9', { method: 'PATCH', body: JSON.stringify(body) });
}

const ctx = () => ({ params: Promise.resolve({ id: '9' }) });

beforeEach(() => {
  estado.reglaActual = { id: 9, status: 'propuesta', kind: 'nueva', agent_key: 'ventas' };
  estado.actualizacion = null;
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { email: 'ale@bralto.io' }, error: null });
});

describe('PATCH /api/rules/[id]', () => {
  it('aprueba una regla propuesta', async () => {
    const res = await PATCH(req({ action: 'aprobar' }), ctx());

    expect(res.status).toBe(200);
    expect(estado.actualizacion).toMatchObject({
      status: 'aprobada',
      reviewed_by: 'ale@bralto.io',
    });
  });

  it('permite editar el texto al aprobar — la última palabra es humana', async () => {
    await PATCH(
      req({ action: 'aprobar', rule_text: 'TEXTO EDITADO', trigger_text: 'CUÁNDO EDITADO' }),
      ctx(),
    );

    expect(estado.actualizacion).toMatchObject({
      rule_text: 'TEXTO EDITADO',
      trigger_text: 'CUÁNDO EDITADO',
      status: 'aprobada',
    });
  });

  it('rechaza con motivo', async () => {
    await PATCH(req({ action: 'rechazar', rejection_reason: 'no aplica' }), ctx());

    expect(estado.actualizacion).toMatchObject({
      status: 'rechazada',
      rejection_reason: 'no aplica',
    });
  });

  it('NO deja aprobar una regla de tipo conflicto', async () => {
    estado.reglaActual = { id: 9, status: 'propuesta', kind: 'conflicto', agent_key: 'ventas' };

    const res = await PATCH(req({ action: 'aprobar' }), ctx());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/ya está cubierta/i);
    expect(estado.actualizacion).toBeNull();
  });

  it('NO deja aprobar una regla ya aplicada', async () => {
    estado.reglaActual = { id: 9, status: 'aplicada', kind: 'nueva', agent_key: 'ventas' };

    const res = await PATCH(req({ action: 'aprobar' }), ctx());

    expect(res.status).toBe(409);
    expect(estado.actualizacion).toBeNull();
  });

  it('devuelve 404 si la regla no existe', async () => {
    estado.reglaActual = null;

    const res = await PATCH(req({ action: 'aprobar' }), ctx());

    expect(res.status).toBe(404);
  });

  it('rechaza una acción desconocida', async () => {
    const res = await PATCH(req({ action: 'borrar' }), ctx());

    expect(res.status).toBe(400);
  });

  it('rechaza sin sesión', async () => {
    requireUser.mockResolvedValue({
      user: null,
      error: new Response('No autorizado', { status: 401 }),
    });

    const res = await PATCH(req({ action: 'aprobar' }), ctx());

    expect(res.status).toBe(401);
  });
});
