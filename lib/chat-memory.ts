import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Memoria conversacional del chatbot sobre Supabase (tabla nlcn_chat_memory).
 * Reemplaza el nodo memoryPostgresChat de n8n. La session_key es
 * "<phone>_<agente>" para mantener memorias separadas por agente.
 */

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export function sessionKey(phone: string, agente: string): string {
  return `${phone}_${agente}`;
}

/** Devuelve los últimos `window` turnos en orden cronológico. */
export async function getHistory(key: string, window = 30): Promise<ChatTurn[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('nlcn_chat_memory')
    .select('role, content')
    .eq('session_key', key)
    .order('created_at', { ascending: false })
    .limit(window);
  if (error || !data) return [];
  return (data as ChatTurn[]).reverse();
}

/** Guarda el turno del usuario y la respuesta del asistente. */
export async function appendTurns(key: string, turns: ChatTurn[]): Promise<void> {
  if (turns.length === 0) return;
  const supabase = createAdminClient();
  await supabase
    .from('nlcn_chat_memory')
    .insert(turns.map((t) => ({ session_key: key, role: t.role, content: t.content })));
}
