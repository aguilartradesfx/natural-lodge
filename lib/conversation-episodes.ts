import { CHATBOT_FALLBACK_MESSAGE, REVIEW_IDLE_HOURS } from '@/lib/review-constants';

/**
 * Agrupa los turnos de `chatbot_logs` en episodios de conversación y detecta
 * las señales heurísticas que ordenan la bandeja de revisión.
 *
 * Todo acá es lógica pura: sin Supabase, sin IA, sin reloj. Eso lo hace
 * barato de probar y determinístico, que es justo lo que necesita la
 * idempotencia del barrido.
 */

export type ChatbotLog = {
  id: number;
  phone: string;
  contact_id: string | null;
  message_in: string | null;
  message_out: string | null;
  has_reservation: boolean | null;
  agente_usado: string | null;
  transferir_a_ventas: boolean | null;
  created_at: string;
};

export type Signal =
  | 'escalamiento'
  | 'error_bot'
  | 'no_procesable'
  | 'derivado_ventas'
  | 'conversacion_larga';

export type Episode = {
  phone: string;
  agente: string;
  contact_id: string | null;
  window_start: string;
  window_end: string;
  turn_count: number;
  logs: ChatbotLog[];
  signals: Signal[];
  signal_weight: number;
};

export const SIGNAL_WEIGHTS: Record<Signal, number> = {
  escalamiento: 40,
  error_bot: 40,
  no_procesable: 25,
  derivado_ventas: 20,
  conversacion_larga: 15,
};

/** Etiquetas para los chips de la bandeja. */
export const SIGNAL_LABELS: Record<Signal, string> = {
  escalamiento: 'Escaló a humano',
  error_bot: 'El bot dio error',
  no_procesable: 'No pudo procesar',
  derivado_ventas: 'Derivado a ventas',
  conversacion_larga: 'Conversación larga',
};

const TURNOS_CONVERSACION_LARGA = 8;
const AGENTE_DESCONOCIDO = 'desconocido';

export function detectSignals(logs: ChatbotLog[]): Signal[] {
  const señales = new Set<Signal>();

  for (const l of logs) {
    if (l.agente_usado === 'escalamiento') señales.add('escalamiento');
    if (l.agente_usado === 'sistema') señales.add('no_procesable');
    if (l.transferir_a_ventas === true) señales.add('derivado_ventas');
    if ((l.message_out ?? '').trim() === CHATBOT_FALLBACK_MESSAGE) señales.add('error_bot');
  }

  if (logs.length >= TURNOS_CONVERSACION_LARGA) señales.add('conversacion_larga');

  return [...señales];
}

export function signalWeight(signals: Signal[]): number {
  return signals.reduce((total, s) => total + (SIGNAL_WEIGHTS[s] ?? 0), 0);
}

/**
 * Parte los logs en episodios. Agrupa por (teléfono, agente) y corta cada vez
 * que el silencio entre dos turnos llega o supera `idleHours`.
 */
export function splitIntoEpisodes(
  logs: ChatbotLog[],
  idleHours: number = REVIEW_IDLE_HOURS,
): Episode[] {
  const huecoMs = idleHours * 60 * 60 * 1000;

  // Agrupar por conversación. Un agente nulo entra como "desconocido" en vez
  // de descartarse: si el bot falló antes de rutear, el episodio igual importa.
  const porConversacion = new Map<string, ChatbotLog[]>();
  for (const l of logs) {
    const agente = l.agente_usado || AGENTE_DESCONOCIDO;
    const clave = `${l.phone} ${agente}`;
    const grupo = porConversacion.get(clave);
    if (grupo) grupo.push(l);
    else porConversacion.set(clave, [l]);
  }

  const episodios: Episode[] = [];

  for (const [clave, grupo] of porConversacion) {
    const [phone, agente] = clave.split(' ');
    const ordenados = [...grupo].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );

    let bloque: ChatbotLog[] = [];
    for (const l of ordenados) {
      const anterior = bloque[bloque.length - 1];
      const hayCorte =
        anterior !== undefined &&
        Date.parse(l.created_at) - Date.parse(anterior.created_at) >= huecoMs;

      if (hayCorte) {
        episodios.push(construirEpisodio(phone, agente, bloque));
        bloque = [];
      }
      bloque.push(l);
    }
    if (bloque.length > 0) episodios.push(construirEpisodio(phone, agente, bloque));
  }

  return episodios;
}

function construirEpisodio(phone: string, agente: string, logs: ChatbotLog[]): Episode {
  const signals = detectSignals(logs);
  return {
    phone,
    agente,
    // El contact_id más reciente del bloque: es el que sigue vigente en GHL.
    contact_id: [...logs].reverse().find((l) => l.contact_id)?.contact_id ?? null,
    window_start: logs[0].created_at,
    window_end: logs[logs.length - 1].created_at,
    turn_count: logs.length,
    logs,
    signals,
    signal_weight: signalWeight(signals),
  };
}
