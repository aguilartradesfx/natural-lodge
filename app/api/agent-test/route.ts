import { anthropic, ANTHROPIC_MODEL } from '@/lib/anthropic';
import { requireUser } from '@/lib/api-auth';
import { decideRoute, ESCALATION_RESPONSE, type AgentKey } from '@/lib/agent-router';
import { buildFullSystemPrompt, type MockReservation } from '@/lib/prompt-context';
import { sanitizeAgentResponse } from '@/lib/prompt-sanitizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type RequestBody = {
  mode: 'isolated' | 'flow';
  agentKey?: AgentKey;
  messages: ChatMessage[];
  mockContext?: {
    phone?: string;
    hasReservation?: boolean;
    reservation?: Partial<MockReservation>;
  };
  sanitize?: boolean;
};

function pickAgentByMode(
  mode: 'isolated' | 'flow',
  explicit: AgentKey | undefined,
  lastUserMessage: string,
  hasReservation: boolean,
): { kind: 'agent'; agent: AgentKey } | { kind: 'escalation' } {
  if (mode === 'isolated') {
    return { kind: 'agent', agent: explicit || 'soporte' };
  }
  return decideRoute({ message: lastUserMessage, hasReservation });
}

function buildMockReservation(input?: Partial<MockReservation>): MockReservation {
  return {
    guest_name: input?.guest_name || 'Huésped Prueba',
    reservation_id: input?.reservation_id || 'TEST-0001',
    check_in: input?.check_in || '2026-06-01',
    check_out: input?.check_out || '2026-06-03',
    room_type: input?.room_type || 'Bungalow Estándar',
    status: input?.status || 'Commit',
    hotel_name: input?.hotel_name || 'Natural Lodge Caño Negro',
  };
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const mode = body.mode || 'isolated';
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return Response.json({ error: 'Se requiere al menos un mensaje del usuario' }, { status: 400 });
  }
  const lastUser = messages[messages.length - 1].content || '';
  const hasReservation = !!body.mockContext?.hasReservation;
  const phone = body.mockContext?.phone || '+50600000000';

  const decision = pickAgentByMode(mode, body.agentKey, lastUser, hasReservation);

  if (decision.kind === 'escalation') {
    const payload = {
      type: 'escalation' as const,
      agent: null,
      message: ESCALATION_RESPONSE,
    };
    return new Response(`event: meta\ndata: ${JSON.stringify(payload)}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  const agentKey = decision.agent;

  const { data: promptRow, error: promptErr } = await auth.supabase!
    .from('nlcn_agent_prompts')
    .select('system_prompt')
    .eq('agent_key', agentKey)
    .single();

  if (promptErr || !promptRow) {
    return Response.json({ error: `No se encontró el prompt del agente "${agentKey}"` }, { status: 404 });
  }

  const reservation = hasReservation ? buildMockReservation(body.mockContext?.reservation) : null;
  const systemPrompt = buildFullSystemPrompt({
    systemPrompt: promptRow.system_prompt,
    guestContext: { phone, reservation },
  });

  const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const meta = { type: 'meta' as const, agent: agentKey };
      controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`));

      try {
        const anthropicStream = await anthropic.messages.stream({
          model: ANTHROPIC_MODEL,
          max_tokens: 2048,
          system: systemPrompt,
          messages: apiMessages,
        });

        let full = '';
        for await (const event of anthropicStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const chunk = event.delta.text;
            full += chunk;
            controller.enqueue(
              encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`),
            );
          }
        }

        let finalMessage = full;
        let transferToSales = false;
        if (body.sanitize !== false) {
          const sanitized = sanitizeAgentResponse(full);
          finalMessage = sanitized.message;
          transferToSales = sanitized.transferToSales;
        }

        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({ finalMessage, transferToSales })}\n\n`,
          ),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        console.error('[agent-test]', err);
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
