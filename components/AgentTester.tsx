'use client';
import { useRef, useState } from 'react';
import { MessageSquare, Loader2, RotateCcw, Send, ChevronDown, User, Bot, AlertCircle } from 'lucide-react';

type Prompt = {
  agent_key: string;
  display_name: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  meta?: { agent?: string | null; escalation?: boolean; error?: string };
};

type Mode = 'isolated' | 'flow';

export function AgentTester({ prompts }: { prompts: Prompt[] }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<Mode>('isolated');
  const [agentKey, setAgentKey] = useState(prompts[0]?.agent_key || 'soporte');
  const [hasReservation, setHasReservation] = useState(false);
  const [guestName, setGuestName] = useState('Huésped Prueba');
  const [phone, setPhone] = useState('+50688887777');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToEnd() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }

  function reset() {
    setMessages([]);
    setError(null);
  }

  async function send() {
    if (!input.trim() || sending) return;
    setError(null);

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    const placeholder: ChatMessage = { role: 'assistant', content: '' };
    const next = [...messages, userMsg, placeholder];
    setMessages(next);
    setInput('');
    setSending(true);
    scrollToEnd();

    const payload = {
      mode,
      agentKey: mode === 'isolated' ? agentKey : undefined,
      messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })),
      mockContext: {
        phone,
        hasReservation: mode === 'flow' ? hasReservation : false,
        reservation: hasReservation ? { guest_name: guestName } : undefined,
      },
    };

    try {
      const res = await fetch('/api/agent-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantIdx = next.length - 1;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
          if (!evt.trim()) continue;
          const lines = evt.split('\n');
          const eventLine = lines.find((l) => l.startsWith('event:'));
          const dataLine = lines.find((l) => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;
          const eventName = eventLine.slice(6).trim();
          const data = JSON.parse(dataLine.slice(5).trim());

          if (eventName === 'meta') {
            if (data.type === 'escalation') {
              setMessages((arr) => {
                const copy = [...arr];
                copy[assistantIdx] = {
                  role: 'assistant',
                  content: data.message,
                  meta: { agent: null, escalation: true },
                };
                return copy;
              });
              scrollToEnd();
            } else {
              setMessages((arr) => {
                const copy = [...arr];
                copy[assistantIdx] = {
                  ...copy[assistantIdx],
                  meta: { agent: data.agent },
                };
                return copy;
              });
            }
          } else if (eventName === 'delta') {
            setMessages((arr) => {
              const copy = [...arr];
              copy[assistantIdx] = {
                ...copy[assistantIdx],
                content: copy[assistantIdx].content + data.text,
              };
              return copy;
            });
            scrollToEnd();
          } else if (eventName === 'done') {
            setMessages((arr) => {
              const copy = [...arr];
              copy[assistantIdx] = {
                ...copy[assistantIdx],
                content: data.finalMessage,
              };
              return copy;
            });
          } else if (eventName === 'error') {
            setError(data.message);
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      setError(msg);
      setMessages((arr) => arr.slice(0, -1));
    } finally {
      setSending(false);
      scrollToEnd();
    }
  }

  return (
    <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="w-full p-6 flex items-center justify-between text-left hover:bg-white/[0.01] transition"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[--color-surface-elevated] border border-[--color-border] flex items-center justify-center">
            <MessageSquare size={16} className="text-[--color-cyan]" />
          </div>
          <div>
            <h3 className="text-lg font-medium">Tester de conversación</h3>
            <p className="text-sm text-[--color-text-muted] mt-0.5">
              Probá los cerebros aislados o el flujo completo con routing.
            </p>
          </div>
        </div>
        <ChevronDown
          size={18}
          className={`text-[--color-text-dim] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-[--color-border]/50">
          {/* Config */}
          <div className="pt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-2 block">
                Modo
              </label>
              <div className="inline-flex rounded-lg border border-[--color-border] p-1 bg-[--color-surface]">
                {(['isolated', 'flow'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono transition ${
                      mode === m
                        ? 'bg-[--color-surface-elevated] text-[--color-text] border border-[--color-cyan]/40'
                        : 'text-[--color-text-muted] hover:text-[--color-text]'
                    }`}
                  >
                    {m === 'isolated' ? 'Aislado' : 'Flujo completo'}
                  </button>
                ))}
              </div>
              <p className="font-mono text-xs text-[--color-text-dim] mt-2 leading-relaxed">
                {mode === 'isolated'
                  ? 'Conversás directo con el cerebro elegido.'
                  : 'Replica el routing de n8n: escalamiento → reserva → BigDay → ventas.'}
              </p>
            </div>

            {mode === 'isolated' ? (
              <div>
                <label className="font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-2 block">
                  Cerebro
                </label>
                <select
                  value={agentKey}
                  onChange={(e) => setAgentKey(e.target.value)}
                  className="w-full bg-[--color-bg] border border-[--color-border] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[--color-cyan]/40"
                >
                  {prompts.map((p) => (
                    <option key={p.agent_key} value={p.agent_key}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="font-mono text-xs uppercase tracking-wider text-[--color-text-dim] block">
                  Contexto simulado
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={hasReservation}
                    onChange={(e) => setHasReservation(e.target.checked)}
                    className="accent-[--color-cyan]"
                  />
                  El huésped tiene reserva activa
                </label>
                {hasReservation && (
                  <input
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Nombre del huésped"
                    className="w-full bg-[--color-bg] border border-[--color-border] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[--color-cyan]/40"
                  />
                )}
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+50688887777"
                  className="w-full bg-[--color-bg] border border-[--color-border] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[--color-cyan]/40"
                />
              </div>
            )}
          </div>

          {/* Chat history */}
          <div
            ref={scrollRef}
            className="mt-5 rounded-xl border border-[--color-border] bg-[--color-bg] h-80 overflow-y-auto p-4 space-y-3"
          >
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <MessageSquare size={20} className="text-[--color-text-dim] mb-2" />
                <p className="font-mono text-xs text-[--color-text-dim]">
                  Empezá la conversación abajo
                </p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-lg bg-[--color-surface] border border-[--color-border] flex items-center justify-center shrink-0">
                      {m.meta?.escalation ? (
                        <AlertCircle size={12} className="text-[--color-amber]" />
                      ) : (
                        <Bot size={12} className="text-[--color-cyan]" />
                      )}
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-[--color-cyan]/15 border border-[--color-cyan]/30'
                        : m.meta?.escalation
                        ? 'bg-[--color-amber]/10 border border-[--color-amber]/30'
                        : 'bg-[--color-surface] border border-[--color-border]'
                    }`}
                  >
                    {m.role === 'assistant' && m.meta?.agent && (
                      <div className="font-mono text-[10px] uppercase tracking-wider text-[--color-text-dim] mb-1">
                        {m.meta.agent}
                      </div>
                    )}
                    {m.content || (
                      <Loader2 size={12} className="animate-spin text-[--color-text-dim]" />
                    )}
                  </div>
                  {m.role === 'user' && (
                    <div className="w-7 h-7 rounded-lg bg-[--color-surface] border border-[--color-border] flex items-center justify-center shrink-0">
                      <User size={12} className="text-[--color-text-muted]" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {error && (
            <div className="mt-3 px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-300 font-mono">
              {error}
            </div>
          )}

          {/* Input */}
          <div className="mt-4 flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Escribí como si fueras el huésped..."
              className="flex-1 bg-[--color-bg] border border-[--color-border] rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-[--color-cyan]/40 transition"
            />
            <button
              onClick={reset}
              disabled={messages.length === 0 || sending}
              className="p-2.5 rounded-lg border border-[--color-border] bg-[--color-surface] text-[--color-text-muted] hover:text-[--color-text] disabled:opacity-40 disabled:cursor-not-allowed transition"
              title="Reiniciar conversación"
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="px-4 py-2.5 rounded-lg text-sm font-medium border bg-[--color-surface-elevated] border-[--color-cyan]/30 hover:border-[--color-cyan]/60 hover:shadow-[0_0_16px_rgba(6,182,212,0.18)] disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
