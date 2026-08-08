export type AgentKey = 'soporte' | 'bigday' | 'ventas';

export const ESCALATION_KEYWORDS = [
  'hablar con una persona',
  'agente humano',
  'persona real',
  'quiero hablar con alguien',
  'operador',
  'recepción directa',
  'recepcion directa',
  'hablar con un humano',
  'necesito ayuda real',
  'no quiero bot',
  'talk to a human',
  'real person',
  'speak to someone',
  'quiero un agente',
  'comunicarme con recepcion',
  'comunicarme con recepción',
];

/**
 * Configuración del agente de evento (hoy "Big Day"), que se edita desde el
 * panel y llega desde `nlcn_agent_prompts`.
 *
 * Antes las palabras estaban escritas acá y cambiar de evento exigía tocar
 * código. Ahora el nombre, las palabras y el encendido son datos.
 */
export type EventAgentConfig = {
  agentKey: AgentKey;
  isEnabled: boolean;
  keywords: string[];
};

export type RouterDecision =
  | { kind: 'escalation' }
  | { kind: 'agent'; agent: AgentKey };

/** ¿Alguna palabra del evento aparece en el mensaje? */
function matchesEvent(msg: string, event: EventAgentConfig | null | undefined): boolean {
  if (!event || !event.isEnabled) return false;
  return event.keywords.some((kw) => {
    const limpia = kw.trim().toLowerCase();
    return limpia.length > 0 && msg.includes(limpia);
  });
}

export function decideRoute(opts: {
  message: string;
  hasReservation: boolean;
  /**
   * Si no se pasa, o si el evento está apagado, el ruteo simplemente ignora
   * al agente de evento: la conversación cae en soporte o ventas según la
   * reserva. Es la degradación correcta — nadie se queda sin respuesta.
   */
  eventAgent?: EventAgentConfig | null;
}): RouterDecision {
  const msg = (opts.message || '').toLowerCase();

  if (ESCALATION_KEYWORDS.some((kw) => msg.includes(kw))) {
    return { kind: 'escalation' };
  }

  // El evento se evalúa ANTES que la reserva. Un huésped alojado que pregunta
  // por una boda quiere al agente del evento, no a soporte: antes la reserva
  // ganaba siempre y esas consultas terminaban contestadas por el agente
  // equivocado.
  if (matchesEvent(msg, opts.eventAgent)) {
    return { kind: 'agent', agent: opts.eventAgent!.agentKey };
  }
  if (opts.hasReservation) return { kind: 'agent', agent: 'soporte' };
  return { kind: 'agent', agent: 'ventas' };
}

export const ESCALATION_RESPONSE =
  'Entendemos tu solicitud. En breve un miembro de nuestro equipo se comunicará contigo personalmente. Si necesitas atención inmediata, puedes contactar a nuestra recepción directamente. ¡Gracias por tu paciencia!';
