import { describe, it, expect, vi, beforeEach } from 'vitest';

const { estado } = vi.hoisted(() => ({
  estado: {
    rpcArgs: null as Record<string, unknown> | null,
    rpcResult: { data: [{ version_id: 9, version_number: 3 }] as unknown, error: null as unknown },
    versionRow: null as Record<string, unknown> | null,
    versionesLista: [] as unknown[],
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      if (nombre !== 'nlcn_apply_prompt_version') throw new Error(`rpc inesperada: ${nombre}`);
      estado.rpcArgs = args;
      return estado.rpcResult;
    },
    from(tabla: string) {
      if (tabla !== 'nlcn_prompt_versions') throw new Error(`tabla inesperada: ${tabla}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: estado.versionRow, error: null }) }),
            order: () => ({ limit: async () => ({ data: estado.versionesLista, error: null }) }),
          }),
        }),
      };
    },
  }),
}));

import { applyPromptChange, listVersions, restoreVersion } from './prompt-versions';

beforeEach(() => {
  estado.rpcArgs = null;
  estado.rpcResult = { data: [{ version_id: 9, version_number: 3 }], error: null };
  estado.versionRow = null;
  estado.versionesLista = [];
});

describe('applyPromptChange', () => {
  it('llama a la función atómica con los parámetros correctos', async () => {
    const res = await applyPromptChange({
      agentKey: 'ventas',
      systemPrompt: 'PROMPT NUEVO',
      ruleIds: [1, 2],
      changeSummary: '2 reglas integradas',
      userEmail: 'ale@bralto.io',
    });

    expect(res).toEqual({ versionId: 9, versionNumber: 3 });
    expect(estado.rpcArgs).toEqual({
      p_agent_key: 'ventas',
      p_system_prompt: 'PROMPT NUEVO',
      p_rule_ids: [1, 2],
      p_change_summary: '2 reglas integradas',
      p_created_by: 'ale@bralto.io',
    });
  });

  it('lanza si la función SQL devuelve error', async () => {
    estado.rpcResult = { data: null, error: { message: 'No existe el agente x' } };

    await expect(
      applyPromptChange({
        agentKey: 'x',
        systemPrompt: 'P',
        ruleIds: [],
        changeSummary: 's',
        userEmail: 'a@b.c',
      }),
    ).rejects.toThrow('No existe el agente x');
  });

  it('lanza si el prompt viene vacío — nunca se borra el prompt vivo', async () => {
    await expect(
      applyPromptChange({
        agentKey: 'ventas',
        systemPrompt: '   ',
        ruleIds: [],
        changeSummary: 's',
        userEmail: 'a@b.c',
      }),
    ).rejects.toThrow(/vacío/i);
    expect(estado.rpcArgs).toBeNull();
  });
});

describe('listVersions', () => {
  it('devuelve las versiones normalizando rule_ids', async () => {
    estado.versionesLista = [
      {
        id: 2,
        agent_key: 'ventas',
        version_number: 2,
        system_prompt: 'P2',
        change_summary: null,
        rule_ids: [3],
        created_by: null,
        created_at: '2026-08-01T00:00:00Z',
      },
    ];

    const res = await listVersions('ventas');

    expect(res).toHaveLength(1);
    expect(res[0].rule_ids).toEqual([3]);
  });

  it('rule_ids nulo se normaliza a lista vacía', async () => {
    estado.versionesLista = [
      {
        id: 1,
        agent_key: 'ventas',
        version_number: 1,
        system_prompt: 'P1',
        change_summary: null,
        rule_ids: null,
        created_by: null,
        created_at: '2026-08-01T00:00:00Z',
      },
    ];

    expect((await listVersions('ventas'))[0].rule_ids).toEqual([]);
  });
});

describe('restoreVersion', () => {
  it('escribe el prompt de la versión pedida como versión nueva', async () => {
    estado.versionRow = { id: 4, version_number: 2, system_prompt: 'PROMPT DE LA V2' };

    const res = await restoreVersion({
      agentKey: 'ventas',
      versionId: 4,
      userEmail: 'ale@bralto.io',
    });

    expect(res).toEqual({ versionId: 9, versionNumber: 3 });
    expect(estado.rpcArgs?.p_system_prompt).toBe('PROMPT DE LA V2');
    expect(estado.rpcArgs?.p_change_summary).toBe('Restaurado desde v2');
    expect(estado.rpcArgs?.p_rule_ids).toEqual([]);
  });

  it('lanza si la versión no existe o no es de ese agente', async () => {
    estado.versionRow = null;

    await expect(
      restoreVersion({ agentKey: 'ventas', versionId: 99, userEmail: 'a@b.c' }),
    ).rejects.toThrow(/no existe/i);
  });
});
