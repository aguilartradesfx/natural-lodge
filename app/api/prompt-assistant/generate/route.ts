import { anthropic, ANTHROPIC_MODEL } from '@/lib/anthropic';
import { requireUser } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM = `Sos un experto en prompt engineering para asistentes de WhatsApp de un lodge en Costa Rica (Natural Lodge Caño Negro). Tu rol es ayudar al equipo del hotel — gente NO técnica — a convertir una idea o instrucción coloquial en un fragmento de system prompt limpio, claro y listo para inyectar en uno o más agentes existentes.

Lineamientos:
- Devolvé SOLO el fragmento, sin meta-comentarios, sin "aquí tienes", sin markdown decorativo.
- Escribilo en español neutro, en segundo persona dirigido al modelo ("Cuando el huésped..."), tono profesional y cálido.
- Si la idea define una regla, formulala como instrucción imperativa.
- Si menciona datos concretos (precios, horarios, contactos), conservalos textuales.
- Si la idea es ambigua, hacé la asunción más razonable y seguí — no preguntés de vuelta.
- Mantenelo conciso: idealmente entre 2 y 12 líneas. Solo más largo si la idea lo amerita.
- No incluyas el contexto del huésped, datos dinámicos ni placeholders — esos los inyecta el workflow automáticamente.`;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: { instruction?: string; targetAgents?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const instruction = (body.instruction || '').trim();
  if (!instruction) {
    return Response.json({ error: 'Falta la instrucción' }, { status: 400 });
  }
  if (instruction.length > 4000) {
    return Response.json({ error: 'La instrucción es demasiado larga (máx 4000 caracteres)' }, { status: 400 });
  }

  const targets = Array.isArray(body.targetAgents) && body.targetAgents.length
    ? `\n\nAgentes destino: ${body.targetAgents.join(', ')}.`
    : '';

  try {
    const msg = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Convertí la siguiente idea del equipo en un fragmento de prompt:${targets}\n\n---\n${instruction}\n---`,
        },
      ],
    });

    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();

    return Response.json({ fragment: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[prompt-assistant/generate]', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
