/**
 * Constantes del ciclo de retroalimentación. Sin I/O y sin `server-only`:
 * los componentes de cliente también leen las etiquetas de señal.
 */

/**
 * Mensaje que el chatbot envía cuando Claude falla. Vive acá (y no como
 * literal en la ruta) porque la detección de la señal `error_bot` lo compara
 * contra `message_out`: si el texto cambiara en un solo lugar, la señal
 * dejaría de dispararse en silencio.
 */
export const CHATBOT_FALLBACK_MESSAGE =
  '¡Hola! Disculpa, tengo dificultades para procesar tu consulta en este momento. ¿Podrías intentar nuevamente o comunicarte directamente con nuestra recepción?';

/** Silencio (en horas) que cierra un episodio de conversación. */
export const REVIEW_IDLE_HOURS = Number(process.env.REVIEW_IDLE_HOURS ?? 6);

/** Tope de episodios por corrida del barrido (maxDuration = 60s en Vercel). */
export const REVIEW_BATCH_SIZE = Number(process.env.REVIEW_BATCH_SIZE ?? 20);

/** Agentes a los que una regla aprendida puede apuntar. */
export const RULE_AGENT_KEYS = ['soporte', 'bigday', 'ventas'] as const;
export type RuleAgentKey = (typeof RULE_AGENT_KEYS)[number];

export function isRuleAgentKey(value: string): value is RuleAgentKey {
  return (RULE_AGENT_KEYS as readonly string[]).includes(value);
}
