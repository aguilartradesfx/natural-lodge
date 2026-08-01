import { describe, it, expect, vi, beforeEach } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create } },
  ANTHROPIC_RULES_MODEL: 'claude-opus-5',
}));

import {
  canTransition,
  draftRuleFromFeedback,
  buildConsolidatedFragment,
  consolidateIntoPrompt,
} from './learned-rules';

function respuestaJson(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function respuestaTexto(texto: string) {
  return { content: [{ type: 'text', text: texto }] };
}

const DRAFT_OK = {
  kind: 'nueva',
  agent_key: 'ventas',
  trigger_text: 'el huésped pregunta cómo llegar desde Liberia',
  rule_text:
    'Cuando el huésped pregunte cómo llegar desde el aeropuerto de Liberia, ofrecé primero el traslado privado del lodge con su precio.',
  rationale: 'Perdimos una venta porque el bot mandó al cliente a tomar bus.',
  conflict_excerpt: null,
};

const ENTRADA = {
  transcript: '[turno 1 · log 1]\nHuésped: ¿cómo llego desde Liberia?\nBot: Podés tomar un bus.',
  summary: 'El huésped preguntó cómo llegar.',
  comment: 'Perdimos una venta, el bot mandó al cliente a tomar bus.',
  anchors: [{ message_out: 'Podés tomar un bus.', comment: 'acá falló' }],
  agente: 'ventas',
  currentPrompt: 'Sos el asistente de ventas del lodge.',
};

beforeEach(() => {
  create.mockReset();
});

describe('canTransition', () => {
  it('permite propuesta → aprobada para una regla nueva', () => {
    expect(canTransition('propuesta', 'aprobada', 'nueva')).toBe(true);
  });

  it('permite propuesta → rechazada', () => {
    expect(canTransition('propuesta', 'rechazada', 'nueva')).toBe(true);
  });

  it('permite aprobada → aplicada', () => {
    expect(canTransition('aprobada', 'aplicada', 'nueva')).toBe(true);
  });

  it('permite aprobada → rechazada (arrepentirse antes de aplicar)', () => {
    expect(canTransition('aprobada', 'rechazada', 'nueva')).toBe(true);
  });

  it('NO permite aprobar una regla de tipo conflicto', () => {
    expect(canTransition('propuesta', 'aprobada', 'conflicto')).toBe(false);
  });

  it('permite rechazar una regla de tipo conflicto', () => {
    expect(canTransition('propuesta', 'rechazada', 'conflicto')).toBe(true);
  });

  it('NO permite aplicar una regla rechazada', () => {
    expect(canTransition('rechazada', 'aplicada', 'nueva')).toBe(false);
  });

  it('NO permite aprobar una regla ya aplicada', () => {
    expect(canTransition('aplicada', 'aprobada', 'nueva')).toBe(false);
  });

  it('NO permite saltarse la aprobación (propuesta → aplicada)', () => {
    expect(canTransition('propuesta', 'aplicada', 'nueva')).toBe(false);
  });

  it('aplicada y rechazada son terminales', () => {
    expect(canTransition('aplicada', 'rechazada', 'nueva')).toBe(false);
    expect(canTransition('rechazada', 'aprobada', 'nueva')).toBe(false);
  });
});

describe('draftRuleFromFeedback', () => {
  it('devuelve la regla propuesta', async () => {
    create.mockResolvedValue(respuestaJson(DRAFT_OK));

    const draft = await draftRuleFromFeedback(ENTRADA);

    expect(draft.kind).toBe('nueva');
    expect(draft.agent_key).toBe('ventas');
    expect(draft.trigger_text).toContain('Liberia');
    expect(draft.conflict_excerpt).toBeNull();
  });

  it('usa el modelo de reglas', async () => {
    create.mockResolvedValue(respuestaJson(DRAFT_OK));

    await draftRuleFromFeedback(ENTRADA);

    expect(create.mock.calls[0][0].model).toBe('claude-opus-5');
  });

  it('le pasa el prompt actual del agente — es lo que evita duplicados', async () => {
    create.mockResolvedValue(respuestaJson(DRAFT_OK));

    await draftRuleFromFeedback(ENTRADA);

    const contenido = create.mock.calls[0][0].messages[0].content as string;
    expect(contenido).toContain('Sos el asistente de ventas del lodge.');
    expect(contenido).toContain('Perdimos una venta');
    expect(contenido).toContain('acá falló');
  });

  it('marca conflicto cuando la regla ya existe en el prompt', async () => {
    create.mockResolvedValue(
      respuestaJson({
        ...DRAFT_OK,
        kind: 'conflicto',
        conflict_excerpt: 'Ofrecé siempre el traslado privado antes que el bus.',
      }),
    );

    const draft = await draftRuleFromFeedback(ENTRADA);

    expect(draft.kind).toBe('conflicto');
    expect(draft.conflict_excerpt).toContain('traslado privado');
  });

  it('cae al agente del episodio si el modelo devuelve una clave inválida', async () => {
    create.mockResolvedValue(respuestaJson({ ...DRAFT_OK, agent_key: 'recepcion' }));

    const draft = await draftRuleFromFeedback(ENTRADA);

    expect(draft.agent_key).toBe('ventas');
  });

  it('cae a "soporte" si ni el modelo ni el episodio traen un agente válido', async () => {
    create.mockResolvedValue(respuestaJson({ ...DRAFT_OK, agent_key: 'x' }));

    const draft = await draftRuleFromFeedback({ ...ENTRADA, agente: 'escalamiento' });

    expect(draft.agent_key).toBe('soporte');
  });

  it('lanza si el modelo devuelve una regla vacía', async () => {
    create.mockResolvedValue(respuestaJson({ ...DRAFT_OK, rule_text: '   ' }));

    await expect(draftRuleFromFeedback(ENTRADA)).rejects.toThrow(/regla vacía/i);
  });

  it('propaga el error de la API', async () => {
    create.mockRejectedValue(new Error('429 rate limit'));

    await expect(draftRuleFromFeedback(ENTRADA)).rejects.toThrow('429 rate limit');
  });
});

describe('buildConsolidatedFragment', () => {
  it('numera las reglas con su condición y su acción', () => {
    const frag = buildConsolidatedFragment([
      { trigger_text: 'preguntan por transporte', rule_text: 'Ofrecé el traslado privado.' },
      { trigger_text: 'preguntan por el desayuno', rule_text: 'Decí que está incluido.' },
    ]);

    expect(frag).toContain('1.');
    expect(frag).toContain('preguntan por transporte');
    expect(frag).toContain('Ofrecé el traslado privado.');
    expect(frag).toContain('2.');
    expect(frag).toContain('Decí que está incluido.');
  });
});

describe('consolidateIntoPrompt', () => {
  it('devuelve el prompt completo modificado', async () => {
    create.mockResolvedValue(respuestaTexto('PROMPT NUEVO COMPLETO'));

    const res = await consolidateIntoPrompt({
      agentKey: 'ventas',
      currentPrompt: 'PROMPT VIEJO',
      rules: [{ trigger_text: 'x', rule_text: 'y' }],
    });

    expect(res).toBe('PROMPT NUEVO COMPLETO');
    expect(create.mock.calls[0][0].model).toBe('claude-opus-5');
  });

  it('limpia las triple-comillas si el modelo las agrega', async () => {
    create.mockResolvedValue(respuestaTexto('```\nPROMPT NUEVO\n```'));

    const res = await consolidateIntoPrompt({
      agentKey: 'ventas',
      currentPrompt: 'PROMPT VIEJO',
      rules: [{ trigger_text: 'x', rule_text: 'y' }],
    });

    expect(res).toBe('PROMPT NUEVO');
  });

  it('rechaza sin reglas: no tiene sentido tocar el prompt', async () => {
    await expect(
      consolidateIntoPrompt({ agentKey: 'ventas', currentPrompt: 'P', rules: [] }),
    ).rejects.toThrow(/sin reglas/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('lanza si el modelo devuelve un prompt vacío — nunca borra el prompt vivo', async () => {
    create.mockResolvedValue(respuestaTexto('   '));

    await expect(
      consolidateIntoPrompt({
        agentKey: 'ventas',
        currentPrompt: 'PROMPT VIEJO',
        rules: [{ trigger_text: 'x', rule_text: 'y' }],
      }),
    ).rejects.toThrow(/vacío/i);
  });
});
