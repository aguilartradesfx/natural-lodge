import { requireUser } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { canTransition, type RuleKind, type RuleStatus } from '@/lib/learned-rules';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKFLOW = 'revision_reglas';

type Body = {
  action?: string;
  rule_text?: string;
  trigger_text?: string;
  rejection_reason?: string;
};

/**
 * Compuerta 1: una persona aprueba, edita o rechaza la regla propuesta.
 * Nada de esto toca el prompt todavía — eso es la compuerta 2.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { id } = await params;
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) {
    return Response.json({ error: 'Id de regla inválido' }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (body.action !== 'aprobar' && body.action !== 'rechazar') {
    return Response.json({ error: 'La acción debe ser aprobar o rechazar' }, { status: 400 });
  }

  const destino: RuleStatus = body.action === 'aprobar' ? 'aprobada' : 'rechazada';

  try {
    const supabase = createAdminClient();

    const { data: regla, error } = await supabase
      .from('nlcn_learned_rules')
      .select('*')
      .eq('id', ruleId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!regla) return Response.json({ error: 'La regla no existe' }, { status: 404 });

    if (!canTransition(regla.status as RuleStatus, destino, regla.kind as RuleKind)) {
      const motivo =
        regla.kind === 'conflicto' && destino === 'aprobada'
          ? 'Esta regla ya está cubierta por el prompt actual: no se puede aprobar, solo rechazar. El problema es que el bot no la siguió.'
          : `No se puede pasar una regla de "${regla.status}" a "${destino}".`;
      return Response.json({ error: motivo }, { status: 409 });
    }

    const cambios: Record<string, unknown> = {
      status: destino,
      reviewed_by: auth.user?.email || 'desconocido',
      reviewed_at: new Date().toISOString(),
    };

    // La persona tiene la última palabra sobre cada palabra de la regla.
    if (destino === 'aprobada') {
      if (typeof body.rule_text === 'string' && body.rule_text.trim()) {
        cambios.rule_text = body.rule_text.trim();
      }
      if (typeof body.trigger_text === 'string' && body.trigger_text.trim()) {
        cambios.trigger_text = body.trigger_text.trim();
      }
    } else {
      cambios.rejection_reason = body.rejection_reason?.trim() || null;
    }

    const { data: actualizada, error: updateError } = await supabase
      .from('nlcn_learned_rules')
      .update(cambios)
      .eq('id', ruleId)
      .select()
      .single();

    if (updateError) throw new Error(updateError.message);

    return Response.json({ ok: true, rule: actualizada });
  } catch (err) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'patch_regla',
      error: err,
      context: { ruleId },
    });
    return Response.json({ error: 'No se pudo actualizar la regla' }, { status: 500 });
  }
}
