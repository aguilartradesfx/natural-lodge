import { requireUser } from '@/lib/api-auth';
import { restoreVersion } from '@/lib/prompt-versions';
import { isRuleAgentKey } from '@/lib/review-constants';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKFLOW = 'revision_prompt';

type Body = { versionId?: unknown };

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

  const versionId = Number(body.versionId);
  if (!Number.isInteger(versionId)) {
    return Response.json({ error: 'Id de versión inválido' }, { status: 400 });
  }

  try {
    const resultado = await restoreVersion({
      agentKey,
      versionId,
      userEmail: auth.user?.email || 'desconocido',
    });
    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    await logWorkflowError({
      workflow: WORKFLOW,
      node: 'restaurar',
      error: err,
      context: { agentKey, versionId },
    });
    return Response.json({ error: 'No se pudo restaurar la versión' }, { status: 500 });
  }
}
