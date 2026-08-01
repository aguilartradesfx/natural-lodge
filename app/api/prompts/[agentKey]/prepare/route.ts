import { requireUser } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { consolidateIntoPrompt } from '@/lib/learned-rules';
import { isRuleAgentKey } from '@/lib/review-constants';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_prompt';

/**
 * Consolida las reglas aprobadas de un agente en un prompt propuesto.
 * NO guarda nada: devuelve el antes y el después para que la persona vea el
 * diff y decida. Esa decisión es la compuerta 2 (`/apply`).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ agentKey: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { agentKey } = await params;
  if (!isRuleAgentKey(agentKey)) {
    return Response.json({ error: 'Agente desconocido' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    const { data: promptRow, error: promptError } = await supabase
      .from('nlcn_agent_prompts')
      .select('system_prompt')
      .eq('agent_key', agentKey)
      .maybeSingle();

    if (promptError) throw new Error(promptError.message);
    if (!promptRow) return Response.json({ error: 'El agente no tiene prompt' }, { status: 404 });

    const { data: reglas, error: reglasError } = await supabase
      .from('nlcn_learned_rules')
      .select('id, trigger_text, rule_text')
      .eq('agent_key', agentKey)
      .eq('status', 'aprobada')
      .order('created_at', { ascending: true });

    if (reglasError) throw new Error(reglasError.message);
    if (!reglas || reglas.length === 0) {
      return Response.json(
        { error: 'No hay reglas aprobadas pendientes de aplicar' },
        { status: 400 },
      );
    }

    const before = String(promptRow.system_prompt);
    const after = await consolidateIntoPrompt({ agentKey, currentPrompt: before, rules: reglas });

    return Response.json({
      ok: true,
      before,
      after,
      ruleIds: reglas.map((r) => r.id),
      rules: reglas,
    });
  } catch (err) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'preparar',
      error: err,
      context: { agentKey },
    });
    return Response.json({ error: 'No se pudo preparar el cambio' }, { status: 500 });
  }
}
