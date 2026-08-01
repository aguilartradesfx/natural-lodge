import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logWorkflowError } from '@/lib/error-log';
import { REVIEW_BATCH_SIZE, REVIEW_IDLE_HOURS } from '@/lib/review-constants';
import { splitIntoEpisodes, type ChatbotLog } from '@/lib/conversation-episodes';
import { summarizeEpisode } from '@/lib/review-summary';

/**
 * Barrido: encuentra episodios cerrados y sin resumir, los resume y los
 * guarda. Lo usan el cron y el botón "Actualizar bandeja" del panel.
 *
 * Es seguro correrlo dos veces: el índice único (phone, agente, window_end)
 * y el filtro de episodios ya existentes evitan duplicados.
 */

const WORKFLOW = 'revision_resumenes';

/** Ventana de logs que se mira hacia atrás. Más allá de eso ya no interesa. */
const DIAS_HACIA_ATRAS = 30;

export type ScanResult = {
  /** Episodios cerrados y sin revisión encontrados. */
  candidatos: number;
  /** Revisiones efectivamente insertadas en esta corrida. */
  creados: number;
  /** Episodios que fallaron al resumir o al guardar. */
  fallidos: number;
};

export async function scanAndSummarize(opts?: {
  idleHours?: number;
  batchSize?: number;
  now?: Date;
}): Promise<ScanResult> {
  const idleHours = opts?.idleHours ?? REVIEW_IDLE_HOURS;
  const batchSize = opts?.batchSize ?? REVIEW_BATCH_SIZE;
  const ahora = opts?.now ?? new Date();

  const supabase = createAdminClient();

  // Solo mensajes con al menos `idleHours` de antigüedad: los más nuevos
  // pueden pertenecer a una conversación todavía viva.
  const corte = new Date(ahora.getTime() - idleHours * 60 * 60 * 1000).toISOString();
  const desde = new Date(ahora.getTime() - DIAS_HACIA_ATRAS * 24 * 60 * 60 * 1000).toISOString();

  const { data: logs, error } = await supabase
    .from('chatbot_logs')
    .select(
      'id, phone, contact_id, message_in, message_out, has_reservation, agente_usado, transferir_a_ventas, created_at',
    )
    .lte('created_at', corte)
    .gte('created_at', desde)
    .order('created_at', { ascending: true });

  if (error) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'leer_logs', error });
    return { candidatos: 0, creados: 0, fallidos: 0 };
  }

  const episodios = splitIntoEpisodes((logs ?? []) as ChatbotLog[], idleHours);

  // Revisiones ya existentes en la misma ventana temporal.
  const { data: yaRevisados } = await supabase
    .from('nlcn_conversation_reviews')
    .select('phone, agente, window_end')
    .gte('window_end', desde);

  const vistos = new Set(
    (yaRevisados ?? []).map((r) => claveEpisodio(r.phone, r.agente, r.window_end)),
  );

  const pendientes = episodios.filter(
    (ep) => !vistos.has(claveEpisodio(ep.phone, ep.agente, ep.window_end)),
  );

  // Con tope, primero los que más pinta tienen de tener un problema.
  const lote = [...pendientes]
    .sort((a, b) => b.signal_weight - a.signal_weight)
    .slice(0, batchSize);

  let creados = 0;
  let fallidos = 0;

  for (const ep of lote) {
    try {
      const resumen = await summarizeEpisode(ep);

      const { error: insertError } = await supabase.from('nlcn_conversation_reviews').insert({
        phone: ep.phone,
        agente: ep.agente,
        contact_id: ep.contact_id,
        window_start: ep.window_start,
        window_end: ep.window_end,
        turn_count: ep.turn_count,
        summary: resumen.summary,
        topics: resumen.topics,
        outcome: resumen.outcome,
        risk_score: resumen.risk_score,
        signals: ep.signals,
        priority: ep.signal_weight + resumen.risk_score,
        status: 'pendiente',
      });

      if (insertError) throw new Error(insertError.message);
      creados++;
    } catch (err) {
      fallidos++;
      // Se registra y se sigue: un episodio roto no puede bloquear al resto.
      // El índice único garantiza que se reintente en la próxima corrida.
      await logWorkflowError({
        workflow: WORKFLOW,
        node: 'resumir_episodio',
        error: err,
        context: { phone: ep.phone, agente: ep.agente, window_end: ep.window_end },
      });
    }
  }

  return { candidatos: pendientes.length, creados, fallidos };
}

/**
 * Clave de identidad de un episodio. `window_end` se normaliza a epoch porque
 * Postgres devuelve el timestamptz con otro formato que el string original.
 */
function claveEpisodio(phone: string, agente: string, windowEnd: string): string {
  return `${phone}|${agente}|${Date.parse(windowEnd)}`;
}
