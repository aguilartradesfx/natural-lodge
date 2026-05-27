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

export const BIGDAY_KEYWORDS = [
  'avistamiento',
  'big day',
  'bigday',
  'big-day',
  '#bigdaycanonegro',
  'ebird',
  'concurso',
  'pajarero',
  'birding',
  'birdwatching',
  'global big day',
  'dinamica',
  'dinámica',
  'premio caño negro',
  'premio cano negro',
  'foto de ave',
  'fotos de aves',
];

export type RouterDecision =
  | { kind: 'escalation' }
  | { kind: 'agent'; agent: AgentKey };

export function decideRoute(opts: {
  message: string;
  hasReservation: boolean;
}): RouterDecision {
  const msg = (opts.message || '').toLowerCase();

  if (ESCALATION_KEYWORDS.some((kw) => msg.includes(kw))) {
    return { kind: 'escalation' };
  }

  if (opts.hasReservation) return { kind: 'agent', agent: 'soporte' };
  if (BIGDAY_KEYWORDS.some((kw) => msg.includes(kw))) return { kind: 'agent', agent: 'bigday' };
  return { kind: 'agent', agent: 'ventas' };
}

export const ESCALATION_RESPONSE =
  'Entendemos tu solicitud. En breve un miembro de nuestro equipo se comunicará contigo personalmente. Si necesitas atención inmediata, puedes contactar a nuestra recepción directamente. ¡Gracias por tu paciencia!';
