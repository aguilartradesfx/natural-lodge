import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Historial de versiones del system_prompt.
 *
 * Toda escritura pasa por la función SQL `nlcn_apply_prompt_version`, que
 * crea la versión, actualiza el prompt vivo y marca las reglas como aplicadas
 * dentro de una sola transacción. Si algo falla, Postgres revierte todo: nunca
 * queda un prompt actualizado sin su versión de respaldo.
 */

export type PromptVersion = {
  id: number;
  agent_key: string;
  version_number: number;
  system_prompt: string;
  change_summary: string | null;
  rule_ids: number[];
  created_by: string | null;
  created_at: string;
};

export async function applyPromptChange(input: {
  agentKey: string;
  systemPrompt: string;
  ruleIds: number[];
  changeSummary: string;
  userEmail: string;
}): Promise<{ versionId: number; versionNumber: number }> {
  const prompt = input.systemPrompt.trim();
  if (!prompt) {
    throw new Error('El prompt está vacío; no se aplica ningún cambio');
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('nlcn_apply_prompt_version', {
    p_agent_key: input.agentKey,
    p_system_prompt: prompt,
    p_rule_ids: input.ruleIds,
    p_change_summary: input.changeSummary,
    p_created_by: input.userEmail,
  });

  if (error) throw new Error(error.message);

  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error('La función de aplicación no devolvió la versión creada');

  return { versionId: Number(fila.version_id), versionNumber: Number(fila.version_number) };
}

export async function listVersions(agentKey: string, limit = 20): Promise<PromptVersion[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('nlcn_prompt_versions')
    .select('*')
    .eq('agent_key', agentKey)
    .order('version_number', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? []).map((v: Record<string, unknown>) => ({
    ...(v as unknown as PromptVersion),
    rule_ids: Array.isArray(v.rule_ids) ? (v.rule_ids as number[]) : [],
  }));
}

/**
 * Restaurar no reescribe el historial: toma el texto de la versión pedida y lo
 * aplica como una versión NUEVA. Así queda registro de que se restauró y se
 * puede volver a avanzar sin perder nada.
 */
export async function restoreVersion(input: {
  agentKey: string;
  versionId: number;
  userEmail: string;
}): Promise<{ versionId: number; versionNumber: number }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('nlcn_prompt_versions')
    .select('id, version_number, system_prompt')
    .eq('agent_key', input.agentKey)
    .eq('id', input.versionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('La versión no existe para este agente');

  return applyPromptChange({
    agentKey: input.agentKey,
    systemPrompt: String(data.system_prompt),
    ruleIds: [],
    changeSummary: `Restaurado desde v${data.version_number}`,
    userEmail: input.userEmail,
  });
}
