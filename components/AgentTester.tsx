'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  RotateCcw,
  Send,
  Settings2,
  Check,
  CheckCheck,
  ChevronDown,
} from 'lucide-react';

type Prompt = {
  agent_key: string;
  display_name: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  meta?: { agent?: string | null; escalation?: boolean };
  status?: 'sending' | 'sent' | 'delivered' | 'read';
};

type Mode = 'isolated' | 'flow';

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('es-CR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function AgentTester({
  prompts,
  initialAgent,
}: {
  prompts: Prompt[];
  initialAgent?: string;
}) {
  const [mode, setMode] = useState<Mode>('isolated');
  const [agentKey, setAgentKey] = useState(initialAgent || prompts[0]?.agent_key || 'soporte');
  const [hasReservation, setHasReservation] = useState(false);
  const [guestName, setGuestName] = useState('Huésped Prueba');
  const [phone, setPhone] = useState('+50688887777');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToEnd() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }

  useEffect(() => {
    scrollToEnd();
  }, [messages.length]);

  function reset() {
    setMessages([]);
    setError(null);
  }

  const activeAgentLabel =
    mode === 'isolated'
      ? prompts.find((p) => p.agent_key === agentKey)?.display_name || agentKey
      : 'Auto · routing del flujo';

  async function send() {
    if (!input.trim() || sending) return;
    setError(null);

    const now = Date.now();
    const userMsg: ChatMessage = {
      role: 'user',
      content: input.trim(),
      ts: now,
      status: 'sending',
    };
    const placeholder: ChatMessage = { role: 'assistant', content: '', ts: now + 1 };
    const next = [...messages, userMsg, placeholder];
    setMessages(next);
    setInput('');
    setSending(true);

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

    const userIdx = next.length - 2;
    const assistantIdx = next.length - 1;

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

      setMessages((arr) => {
        const copy = [...arr];
        copy[userIdx] = { ...copy[userIdx], status: 'sent' };
        return copy;
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
                  ts: Date.now(),
                  meta: { agent: null, escalation: true },
                };
                copy[userIdx] = { ...copy[userIdx], status: 'read' };
                return copy;
              });
            } else {
              setMessages((arr) => {
                const copy = [...arr];
                copy[assistantIdx] = {
                  ...copy[assistantIdx],
                  meta: { agent: data.agent },
                };
                copy[userIdx] = { ...copy[userIdx], status: 'delivered' };
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
          } else if (eventName === 'done') {
            setMessages((arr) => {
              const copy = [...arr];
              copy[assistantIdx] = {
                ...copy[assistantIdx],
                content: data.finalMessage,
                ts: Date.now(),
              };
              copy[userIdx] = { ...copy[userIdx], status: 'read' };
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
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* WhatsApp header */}
      <div className="bg-[#1f2c33] px-4 py-3 flex items-center gap-3 border-b border-black/20">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[--color-cyan] to-emerald-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
          NL
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[#e9edef] text-sm font-medium truncate">Natural Lodge</div>
          <div className="text-[11px] text-[#8696a0] truncate">
            {sending ? 'escribiendo…' : `en línea · ${activeAgentLabel}`}
          </div>
        </div>
        <button
          onClick={reset}
          disabled={messages.length === 0}
          className="p-2 rounded-full text-[#aebac1] hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition"
          title="Reiniciar conversación"
        >
          <RotateCcw size={16} />
        </button>
        <button
          onClick={() => setShowSettings((x) => !x)}
          className={`p-2 rounded-full transition ${
            showSettings ? 'bg-white/10 text-white' : 'text-[#aebac1] hover:text-white hover:bg-white/5'
          }`}
          title="Configuración"
        >
          <Settings2 size={16} />
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-[#1a242c] border-b border-black/20 p-4 space-y-3">
          <div>
            <div className="text-[#8696a0] uppercase tracking-wider text-[10px] font-medium mb-1.5">
              Modo
            </div>
            <div className="inline-flex rounded-md border border-white/10 p-0.5 bg-black/30 w-full">
              {(['isolated', 'flow'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition ${
                    mode === m
                      ? 'bg-[--color-cyan]/20 text-[--color-cyan-glow] border border-[--color-cyan]/30'
                      : 'text-[#aebac1] hover:text-white'
                  }`}
                >
                  {m === 'isolated' ? 'Aislado' : 'Flujo completo'}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[#8696a0] mt-1.5 leading-snug">
              {mode === 'isolated'
                ? 'Conversás directo con el cerebro elegido.'
                : 'Replica routing de n8n: escalation → reserva → BigDay → ventas.'}
            </p>
          </div>

          {mode === 'isolated' ? (
            <div>
              <div className="text-[#8696a0] uppercase tracking-wider text-[10px] font-medium mb-1.5">
                Cerebro
              </div>
              <select
                value={agentKey}
                onChange={(e) => setAgentKey(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-[#e9edef] focus:outline-none focus:border-[--color-cyan]/40"
              >
                {prompts.map((p) => (
                  <option key={p.agent_key} value={p.agent_key}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[#8696a0] uppercase tracking-wider text-[10px] font-medium">
                Contexto simulado
              </div>
              <label className="flex items-center gap-2 text-xs text-[#e9edef]">
                <input
                  type="checkbox"
                  checked={hasReservation}
                  onChange={(e) => setHasReservation(e.target.checked)}
                  className="accent-[--color-cyan]"
                />
                Tiene reserva activa
              </label>
              {hasReservation && (
                <input
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Nombre del huésped"
                  className="w-full bg-black/30 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-[#e9edef] focus:outline-none focus:border-[--color-cyan]/40"
                />
              )}
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+50688887777"
                className="w-full bg-black/30 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-[#e9edef] focus:outline-none focus:border-[--color-cyan]/40"
              />
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5"
        style={{
          backgroundColor: '#0b141a',
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><path d='M20 20 Q30 10 40 20 T60 20' stroke='%23ffffff' stroke-opacity='0.02' fill='none' stroke-width='1'/><path d='M0 50 Q15 40 30 50 T60 50 T90 50' stroke='%23ffffff' stroke-opacity='0.016' fill='none' stroke-width='1'/></svg>\")",
        }}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <div className="w-12 h-12 rounded-full bg-[--color-cyan]/10 border border-[--color-cyan]/20 flex items-center justify-center mb-3">
              <Send size={16} className="text-[--color-cyan]" />
            </div>
            <p className="text-[#e9edef] text-sm font-medium">Empezá la conversación</p>
            <p className="text-[#8696a0] text-xs mt-1 leading-relaxed">
              Escribí como si fueras un huésped por WhatsApp
            </p>
            <button
              onClick={() => setShowSettings(true)}
              className="mt-4 text-[11px] text-[--color-cyan] hover:text-[--color-cyan-glow] flex items-center gap-1.5"
            >
              <Settings2 size={11} />
              Configurar modo y contexto
            </button>
          </div>
        ) : (
          messages.map((m, i) => {
            const isUser = m.role === 'user';
            return (
              <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`relative max-w-[82%] px-2.5 py-1.5 pb-[20px] rounded-lg text-[13.5px] shadow-sm ${
                    isUser
                      ? 'bg-[#005c4b] text-[#e9edef] rounded-br-sm'
                      : m.meta?.escalation
                      ? 'bg-[#3a2e1e] text-[#fde68a] border border-amber-500/20 rounded-bl-sm'
                      : 'bg-[#202c33] text-[#e9edef] rounded-bl-sm'
                  }`}
                >
                  {!isUser && m.meta?.agent && (
                    <div className="text-[10px] font-medium text-[--color-cyan] mb-0.5 uppercase tracking-wider">
                      {m.meta.agent}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words leading-snug">
                    {m.content || (
                      <span className="inline-flex items-center gap-1 text-[#8696a0]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#8696a0] animate-pulse" />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[#8696a0] animate-pulse"
                          style={{ animationDelay: '0.15s' }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[#8696a0] animate-pulse"
                          style={{ animationDelay: '0.3s' }}
                        />
                      </span>
                    )}
                  </div>
                  <div
                    className={`absolute bottom-1 right-2 flex items-center gap-1 text-[9px] ${
                      isUser ? 'text-[#aebac1]/80' : 'text-[#8696a0]'
                    }`}
                  >
                    <span>{formatTime(m.ts)}</span>
                    {isUser && m.status === 'sending' && (
                      <Loader2 size={9} className="animate-spin" />
                    )}
                    {isUser && m.status === 'sent' && <Check size={11} />}
                    {isUser && m.status === 'delivered' && <CheckCheck size={11} />}
                    {isUser && m.status === 'read' && (
                      <CheckCheck size={11} className="text-[#53bdeb]" />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-900/40 border-t border-red-500/30 text-[11px] text-red-200">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="bg-[#1f2c33] px-3 py-2.5 flex items-end gap-2 border-t border-black/20">
        <div className="flex-1 bg-[#2a3942] rounded-3xl px-4 py-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Mensaje"
            disabled={sending}
            className="w-full bg-transparent text-[#e9edef] text-sm placeholder:text-[#8696a0] focus:outline-none resize-none leading-snug max-h-24"
          />
        </div>
        <button
          onClick={send}
          disabled={!input.trim() || sending}
          className="w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#06cf9c] disabled:bg-[#2a3942] disabled:text-[#8696a0] flex items-center justify-center text-white transition shrink-0"
          title="Enviar"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

// Botón de cabecera reutilizable para abrir el drawer del tester
export function TesterTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-md text-xs font-medium border bg-[--color-surface] border-[--color-border] text-[--color-text-muted] hover:text-[--color-text] hover:border-[--color-border-hover] transition flex items-center gap-1.5"
    >
      Probar chat
      <ChevronDown size={12} className="-rotate-90" />
    </button>
  );
}
