import { requireUser } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyPromptChange } from '@/lib/prompt-versions';
import { isRuleAgentKey } from '@/lib/review-constants';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKFLOW = 'revision_prompt';

type Body = { systemPrompt?: string; ruleIds?: unknown };

/**
 * Compuerta 2: aplica al prompt vivo el texto exacto que la persona aprobó.
 */
export async function POST(req: Request, { params }: { params: Promise<{ agentKey: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { agentKey } = await params;
  if (!isRuleAgentKey(agentKey)) {
    return Response.json({ error: 'Agente desconocido' }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
  if (!systemPrompt) {
    return Response.json({ error: 'El prompt no puede quedar vacío' }, { status: 400 });
  }

  const ruleIds = Array.isArray(body.ruleIds)
    ? body.ruleIds.map(Number).filter(Number.isInteger)
    : [];

  try {
    const supabase = createAdminClient();

    // Revalidar contra la base: entre que se preparó el diff y se apretó
    // aplicar, otra persona pudo rechazar una de esas reglas.
    const { data: aprobadas, error } = await supabase
      .from('nlcn_learned_rules')
      .select('id')
      .eq('agent_key', agentKey)
      .eq('status', 'aprobada')
      .in('id', ruleIds.length ? ruleIds : [-1]);

    if (error) throw new Error(error.message);

    if ((aprobadas ?? []).length !== ruleIds.length) {
      return Response.json(
        { error: 'Las reglas cambiaron mientras revisabas. Preparé el cambio de nuevo.' },
        { status: 409 },
      );
    }

    const resultado = await applyPromptChange({
      agentKey,
      systemPrompt,
      ruleIds,
      changeSummary: `${ruleIds.length} regla${ruleIds.length === 1 ? '' : 's'} integrada${ruleIds.length === 1 ? '' : 's'}`,
      userEmail: auth.user?.email || 'desconocido',
    });

    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'aplicar',
      error: err,
      context: { agentKey },
    });
    return Response.json({ error: 'No se pudo aplicar el cambio' }, { status: 500 });
  }
}
