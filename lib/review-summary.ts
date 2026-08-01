import 'server-only';
import { anthropic, ANTHROPIC_REVIEW_MODEL } from '@/lib/anthropic';
import { SIGNAL_LABELS, type ChatbotLog, type Episode } from '@/lib/conversation-episodes';

/**
 * Resume un episodio de conversación con Claude.
 *
 * Usa salida estructurada (`output_config.format`): la API garantiza la forma
 * del JSON, así que no hay que defenderse de respuestas a medio formatear.
 * Igual se validan los valores (rango, enum) porque el esquema garantiza la
 * forma, no que el modelo elija bien.
 */

export const OUTCOMES = [
  'resuelto',
  'sin_resolver',
  'escalado',
  'derivado_ventas',
  'indeterminado',
] as const;

export type Outcome = (typeof OUTCOMES)[number];

export type ReviewSummary = {
  summary: string;
  topics: string[];
  outcome: Outcome;
  risk_score: number;
};

const SYSTEM = `Sos un analista de calidad de un lodge en Costa Rica (Natural Lodge Caño Negro). Recibís la conversación entre un huésped y el chatbot del hotel, y devolvés una ficha de revisión para que el equipo — gente NO técnica — entienda de un vistazo qué pasó.

Reglas:
- El resumen va en español neutro, en 1 a 3 oraciones. Contá qué pidió el huésped, qué hizo el bot y en qué terminó.
- Escribí para alguien que no leyó la conversación. Nada de jerga ni de referencias a "el turno 3".
- Los temas son etiquetas cortas en minúscula (ej. "check-in", "traslados", "precios"). Entre 1 y 5.
- El desenlace es uno de: resuelto, sin_resolver, escalado, derivado_ventas, indeterminado.
- risk_score es 0-100: qué tan urgente es que una persona revise esta conversación. Alto si el bot dio información dudosa, dejó al huésped sin respuesta, o se perdió una venta. Bajo si fue una consulta simple bien resuelta.
- No inventes datos que no estén en la conversación.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    topics: { type: 'array', items: { type: 'string' } },
    outcome: { type: 'string', enum: [...OUTCOMES] },
    risk_score: { type: 'integer' },
  },
  required: ['summary', 'topics', 'outcome', 'risk_score'],
  additionalProperties: false,
} as const;

/** Arma el transcript legible del episodio. Exportado para poder probarlo. */
export function buildTranscript(logs: ChatbotLog[]): string {
  return logs
    .map((l, i) => {
      const lineas = [`[turno ${i + 1} · log ${l.id}]`];
      if (l.message_in?.trim()) lineas.push(`Huésped: ${l.message_in.trim()}`);
      if (l.message_out?.trim()) lineas.push(`Bot: ${l.message_out.trim()}`);
      return lineas.join('\n');
    })
    .join('\n\n');
}

export async function summarizeEpisode(episode: Episode): Promise<ReviewSummary> {
  const señales = episode.signals.length
    ? episode.signals.map((s) => `${s} (${SIGNAL_LABELS[s]})`).join(', ')
    : 'ninguna';

  const contenido = [
    `Agente que atendió: ${episode.agente}`,
    `Turnos: ${episode.turn_count}`,
    `El huésped tenía reserva activa: ${episode.logs.some((l) => l.has_reservation) ? 'sí' : 'no'}`,
    `Señales automáticas detectadas: ${señales}`,
    '',
    '=== CONVERSACIÓN ===',
    buildTranscript(episode.logs),
    '=== FIN CONVERSACIÓN ===',
  ].join('\n');

  const res = await anthropic.messages.create({
    model: ANTHROPIC_REVIEW_MODEL,
    max_tokens: 8192,
    system: SYSTEM,
    // Extracción estructurada sobre un texto corto: no necesita razonamiento
    // profundo, y el esfuerzo bajo recorta costo y latencia del alto volumen.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: contenido }],
  });

  const bloque = res.content.find((b) => b.type === 'text');
  if (!bloque || bloque.type !== 'text') {
    throw new Error('El modelo devolvió una respuesta vacía al resumir el episodio');
  }

  const bruto = JSON.parse(bloque.text) as ReviewSummary;

  return {
    summary: String(bruto.summary ?? '').trim(),
    topics: Array.isArray(bruto.topics) ? bruto.topics.map(String).slice(0, 5) : [],
    outcome: (OUTCOMES as readonly string[]).includes(bruto.outcome)
      ? bruto.outcome
      : 'indeterminado',
    risk_score: Math.max(0, Math.min(100, Math.round(Number(bruto.risk_score) || 0))),
  };
}
