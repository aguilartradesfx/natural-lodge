import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AgentKey, EventAgentConfig } from '@/lib/agent-router';

/**
 * Lee del panel la configuración del agente de evento (hoy "Big Day").
 *
 * Devuelve null si no hay ninguno marcado como evento o si la consulta falla.
 * En ese caso el ruteo ignora al agente de evento y la conversación cae en
 * soporte o ventas: preferimos que el bot conteste algo razonable antes que
 * quedarse mudo por un problema de lectura.
 */
export async function getEventAgent(): Promise<EventAgentConfig | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('nlcn_agent_prompts')
      .select('agent_key, is_enabled, keywords')
      .eq('is_event', true)
      .maybeSingle();

    if (error || !data) return null;

    return {
      agentKey: data.agent_key as AgentKey,
      isEnabled: data.is_enabled !== false,
      keywords: Array.isArray(data.keywords) ? (data.keywords as string[]).map(String) : [],
    };
  } catch {
    return null;
  }
}
