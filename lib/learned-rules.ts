import 'server-only';
import { anthropic, ANTHROPIC_RULES_MODEL } from '@/lib/anthropic';
import { isRuleAgentKey, RULE_AGENT_KEYS, type RuleAgentKey } from '@/lib/review-constants';

/**
 * Reglas aprendidas: el puente entre el comentario de una persona y el
 * system_prompt del agente.
 *
 * Nada acá escribe en la base: eso vive en las rutas. Este módulo tiene la
 * máquina de estados (pura, muy testeada) y las dos llamadas a Claude.
 */

export type RuleStatus = 'propuesta' | 'aprobada' | 'aplicada' | 'rechazada';
export type RuleKind = 'nueva' | 'conflicto';

export type RuleDraft = {
  kind: RuleKind;
  agent_key: RuleAgentKey;
  trigger_text: string;
  rule_text: string;
  rationale: string;
  conflict_excerpt: string | null;
};

export type LearnedRule = RuleDraft & { id: number; status: RuleStatus };

const TRANSICIONES: Record<RuleStatus, RuleStatus[]> = {
  propuesta: ['aprobada', 'rechazada'],
  aprobada: ['aplicada', 'rechazada'],
  aplicada: [],
  rechazada: [],
};

/**
 * ¿Es válido pasar de `from` a `to`?
 *
 * Una regla de tipo `conflicto` nunca puede aprobarse: significa que el prompt
 * YA contiene la regla y el bot no la siguió. Agregarla otra vez solo infla el
 * prompt y lo acerca a contradecirse consigo mismo.
 */
export function canTransition(from: RuleStatus, to: RuleStatus, kind: RuleKind): boolean {
  if (kind === 'conflicto' && to === 'aprobada') return false;
  return TRANSICIONES[from]?.includes(to) ?? false;
}

// ── Feedback → regla ──────────────────────────────────────────────

const SYSTEM_REGLA = `Sos un editor de system prompts para los agentes de WhatsApp de un lodge en Costa Rica (Natural Lodge Caño Negro). Recibís:
1. Una conversación real entre un huésped y el bot.
2. El resumen de esa conversación.
3. El comentario de una persona del equipo diciendo qué estuvo mal o qué debería haber pasado.
4. El system prompt COMPLETO que tiene hoy ese agente.

Tu tarea: decidir si falta una regla o si la regla ya existe.

- Si el comportamiento que pide la persona NO está cubierto por el prompt actual, devolvés kind="nueva" con la regla redactada para insertarse en el prompt.
- Si el prompt actual YA cubre ese comportamiento, devolvés kind="conflicto" y en conflict_excerpt copiás TEXTUAL la línea o el párrafo del prompt que lo cubre. En ese caso el problema no es que falte la regla, es que el bot no la siguió.

Reglas de redacción (para kind="nueva"):
- rule_text va en español neutro, en segunda persona dirigida al modelo ("Cuando el huésped..."), en imperativo, en el mismo tono y formato del prompt actual.
- Conservá textual todo dato concreto que aparezca en el comentario (precios, horarios, links, números).
- Entre 1 y 6 líneas. Concreta y accionable, no una declaración de principios.
- trigger_text describe en pocas palabras CUÁNDO aplica, en lenguaje llano, para que alguien no técnico lo entienda de un vistazo.
- rationale es el porqué, resumido de lo que dijo la persona.
- No agregues placeholders ni datos del huésped: esos los inyecta el sistema.
- agent_key es el agente al que debe aplicarse: soporte (huéspedes con reserva), bigday (concurso de avistamiento de aves) o ventas (prospectos).`;

const SCHEMA_REGLA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['nueva', 'conflicto'] },
    agent_key: { type: 'string', enum: [...RULE_AGENT_KEYS] },
    trigger_text: { type: 'string' },
    rule_text: { type: 'string' },
    rationale: { type: 'string' },
    conflict_excerpt: { type: ['string', 'null'] },
  },
  required: ['kind', 'agent_key', 'trigger_text', 'rule_text', 'rationale', 'conflict_excerpt'],
  additionalProperties: false,
};

export async function draftRuleFromFeedback(input: {
  transcript: string;
  summary: string;
  comment: string;
  anchors: { message_out: string; comment: string | null }[];
  agente: string;
  currentPrompt: string;
}): Promise<RuleDraft> {
  const anclajes = input.anchors.length
    ? input.anchors
        .map(
          (a, i) =>
            `${i + 1}. Respuesta marcada: "${a.message_out}"\n   Comentario: ${a.comment || '(sin comentario)'}`,
        )
        .join('\n')
    : '(la persona no marcó ninguna respuesta puntual)';

  const contenido = [
    `Agente que atendió: ${input.agente}`,
    '',
    '=== CONVERSACIÓN ===',
    input.transcript,
    '=== FIN CONVERSACIÓN ===',
    '',
    `Resumen: ${input.summary}`,
    '',
    '=== COMENTARIO DEL EQUIPO ===',
    input.comment || '(sin comentario general)',
    '',
    'Respuestas puntuales marcadas:',
    anclajes,
    '=== FIN COMENTARIO ===',
    '',
    '=== PROMPT ACTUAL DEL AGENTE ===',
    input.currentPrompt,
    '=== FIN PROMPT ACTUAL ===',
  ].join('\n');

  const res = await anthropic.messages.create({
    model: ANTHROPIC_RULES_MODEL,
    max_tokens: 8192,
    system: SYSTEM_REGLA,
    output_config: { format: { type: 'json_schema', schema: SCHEMA_REGLA } },
    messages: [{ role: 'user', content: contenido }],
  });

  const bloque = res.content.find((b) => b.type === 'text');
  if (!bloque || bloque.type !== 'text') {
    throw new Error('El modelo devolvió una regla vacía');
  }

  const bruto = JSON.parse(bloque.text) as RuleDraft;
  const ruleText = String(bruto.rule_text ?? '').trim();
  if (!ruleText) throw new Error('El modelo devolvió una regla vacía');

  // Si el modelo eligió un agente que no existe, se cae al del episodio; si
  // ese tampoco es un agente con prompt (escalamiento, sistema), a soporte.
  const agentKey: RuleAgentKey = isRuleAgentKey(bruto.agent_key)
    ? bruto.agent_key
    : isRuleAgentKey(input.agente)
      ? input.agente
      : 'soporte';

  const kind: RuleKind = bruto.kind === 'conflicto' ? 'conflicto' : 'nueva';

  return {
    kind,
    agent_key: agentKey,
    trigger_text: String(bruto.trigger_text ?? '').trim(),
    rule_text: ruleText,
    rationale: String(bruto.rationale ?? '').trim(),
    conflict_excerpt:
      kind === 'conflicto' ? String(bruto.conflict_excerpt ?? '').trim() || null : null,
  };
}

// ── Reglas aprobadas → prompt ─────────────────────────────────────

/** Texto legible de las reglas que van a integrarse. Exportado para tests y UI. */
export function buildConsolidatedFragment(
  rules: Pick<LearnedRule, 'trigger_text' | 'rule_text'>[],
): string {
  return rules
    .map((r, i) => `${i + 1}. Cuándo aplica: ${r.trigger_text}\n   Qué debe hacer: ${r.rule_text}`)
    .join('\n\n');
}

const SYSTEM_CONSOLIDAR = `Sos un editor de system prompts para agentes de IA. Recibís:
1. El system prompt actual de un agente.
2. Un conjunto de reglas nuevas que deben quedar incorporadas.

Tu tarea: devolver el system prompt completo modificado, con cada regla insertada en el lugar más coherente — agrupada con su sección temática, sin duplicar reglas existentes, sin perder ninguna instrucción previa, manteniendo el estilo, formato y voz del prompt original.

Reglas estrictas:
- Devolvé ÚNICAMENTE el prompt final completo, sin explicaciones, sin comentarios, sin envolverlo en triple-backticks.
- No agregues secciones nuevas si una regla encaja en una existente.
- Si una regla contradice algo del prompt actual, dale prioridad a la regla nueva y eliminá la instrucción anterior.
- Conservá literal todo dato concreto de las reglas (precios, horarios, links, números).
- No cambies el tono ni el idioma del prompt original.
- No agregues placeholders ni metadatos del huésped: esos los inyecta el sistema.`;

export async function consolidateIntoPrompt(input: {
  agentKey: string;
  currentPrompt: string;
  rules: Pick<LearnedRule, 'trigger_text' | 'rule_text'>[];
}): Promise<string> {
  if (input.rules.length === 0) {
    throw new Error('No se puede preparar un cambio sin reglas aprobadas');
  }

  const res = await anthropic.messages.create({
    model: ANTHROPIC_RULES_MODEL,
    max_tokens: 16000,
    system: SYSTEM_CONSOLIDAR,
    messages: [
      {
        role: 'user',
        content: [
          `Agente: ${input.agentKey}`,
          '',
          '=== PROMPT ACTUAL ===',
          input.currentPrompt,
          '=== FIN PROMPT ACTUAL ===',
          '',
          '=== REGLAS A INTEGRAR ===',
          buildConsolidatedFragment(input.rules),
          '=== FIN REGLAS ===',
          '',
          'Devolveme el prompt final completo con las reglas integradas.',
        ].join('\n'),
      },
    ],
  });

  const texto = res.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n')
    .trim()
    // El prompt de sistema pide no envolver en backticks, pero si el modelo
    // igual lo hace, guardarlos corrompería el prompt vivo.
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .trim();

  if (!texto) {
    throw new Error('El modelo devolvió un prompt vacío; no se aplica ningún cambio');
  }

  return texto;
}
