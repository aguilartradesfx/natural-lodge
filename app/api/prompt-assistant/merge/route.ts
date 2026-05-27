import { anthropic, ANTHROPIC_MODEL } from '@/lib/anthropic';
import { requireUser } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM = `Sos un editor de system prompts para agentes de IA. Recibís:
1. El system prompt actual de un agente.
2. Un fragmento nuevo que debe quedar incorporado.

Tu tarea: devolver el system prompt completo modificado, con el fragmento insertado en el lugar más coherente — agrupado con su sección temática, sin duplicar reglas existentes, sin perder ninguna instrucción previa, manteniendo el estilo, formato y voz del prompt original.

Reglas estrictas:
- Devolvé ÚNICAMENTE el prompt final completo, sin explicaciones, sin comentarios, sin envolverlo en triple-backticks.
- No agregues secciones nuevas si el fragmento encaja en una existente.
- Si el fragmento contradice algo del prompt actual, dale prioridad al fragmento nuevo y eliminá la regla anterior.
- Conservá literal todo dato concreto del fragmento (precios, horarios, links, números).
- No cambies el tono ni el idioma del prompt original.
- No agregues placeholders ni metadatos del huésped — esos los inyecta el workflow.`;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: { agentKey?: string; fragment?: string; currentPrompt?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const agentKey = (body.agentKey || '').trim();
  const fragment = (body.fragment || '').trim();
  const currentPrompt = (body.currentPrompt || '').trim();

  if (!agentKey) return Response.json({ error: 'Falta agentKey' }, { status: 400 });
  if (!fragment) return Response.json({ error: 'Falta el fragmento' }, { status: 400 });
  if (!currentPrompt) return Response.json({ error: 'Falta el prompt actual' }, { status: 400 });

  try {
    const msg = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Agente: ${agentKey}

=== PROMPT ACTUAL ===
${currentPrompt}
=== FIN PROMPT ACTUAL ===

=== FRAGMENTO A INTEGRAR ===
${fragment}
=== FIN FRAGMENTO ===

Devolveme el prompt final completo con el fragmento integrado.`,
        },
      ],
    });

    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();

    return Response.json({ mergedPrompt: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[prompt-assistant/merge]', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
