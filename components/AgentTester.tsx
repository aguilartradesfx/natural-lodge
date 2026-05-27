'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  RotateCcw,
  Send,
  Settings,
  Phone,
  Video,
  MoreVertical,
  ArrowLeft,
  Check,
  CheckCheck,
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
  const d = new Date(ts);
  return d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function AgentTester({ prompts }: { prompts: Prompt[] }) {
  const [mode, setMode] = useState<Mode>('isolated');
  const [agentKey, setAgentKey] = useState(prompts[0]?.agent_key || 'soporte');
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

      // Marcar mensaje del usuario como enviado
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
    <div className="space-y-3">
      {/* Marco del teléfono */}
      <div className="relative mx-auto w-full max-w-[340px]">
        {/* Glow sutil detrás */}
        <div className="absolute -inset-4 bg-[--color-cyan]/5 rounded-[3rem] blur-2xl pointer-events-none" />

        {/* Carcasa */}
        <div className="relative rounded-[2.5rem] bg-gradient-to-b from-[#1a1a1f] to-[#0a0a0e] p-2 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)_inset]">
          {/* Pantalla */}
          <div className="relative rounded-[2.1rem] overflow-hidden bg-[#0b141a] flex flex-col h-[600px]">
            {/* Notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-black rounded-b-2xl z-30" />

            {/* Status bar */}
            <div className="flex items-center justify-between px-6 pt-2 pb-1 text-[10px] text-white/80 font-medium z-20">
              <span>{new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
              <span className="flex items-center gap-1">
                <span className="w-3.5 h-2 rounded-sm border border-white/60 relative">
                  <span className="absolute inset-[1px] right-[3px] bg-white/80 rounded-[1px]" />
                </span>
              </span>
            </div>

            {/* WhatsApp Header */}
            <div className="bg-[#1f2c33] px-3 py-2.5 flex items-center gap-3 border-b border-black/20">
              <button className="text-[#aebac1] hover:text-white">
                <ArrowLeft size={18} />
              </button>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[--color-cyan] to-emerald-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
                NL
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[#e9edef] text-sm font-medium truncate">Natural Lodge</div>
                <div className="text-[10px] text-[#8696a0] truncate">
                  {sending ? 'escribiendo…' : `en línea · ${activeAgentLabel}`}
                </div>
              </div>
              <button className="text-[#aebac1] hover:text-white">
                <Video size={18} />
              </button>
              <button className="text-[#aebac1] hover:text-white">
                <Phone size={16} />
              </button>
              <button
                onClick={() => setShowSettings((x) => !x)}
                className={`p-1 rounded-full transition ${
                  showSettings ? 'bg-white/10 text-white' : 'text-[#aebac1] hover:text-white'
                }`}
                title="Configuración del tester"
              >
                <MoreVertical size={18} />
              </button>
            </div>

            {/* Settings overlay dentro del teléfono */}
            {showSettings && (
              <div className="absolute top-[88px] right-2 z-20 w-[260px] rounded-xl bg-[#233138] border border-black/30 shadow-2xl p-3 space-y-3 text-xs">
                <div>
                  <div className="text-[#8696a0] uppercase tracking-wider text-[9px] mb-1.5">
                    Modo
                  </div>
                  <div className="inline-flex rounded-md border border-white/10 p-0.5 bg-black/30 w-full">
                    {(['isolated', 'flow'] as Mode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        className={`flex-1 px-2 py-1 rounded text-[11px] transition ${
                          mode === m
                            ? 'bg-[--color-cyan]/20 text-[--color-cyan] border border-[--color-cyan]/30'
                            : 'text-[#aebac1] hover:text-white'
                        }`}
                      >
                        {m === 'isolated' ? 'Aislado' : 'Flujo'}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === 'isolated' ? (
                  <div>
                    <div className="text-[#8696a0] uppercase tracking-wider text-[9px] mb-1.5">
                      Cerebro
                    </div>
                    <select
                      value={agentKey}
                      onChange={(e) => setAgentKey(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-[#e9edef] focus:outline-none focus:border-[--color-cyan]/40"
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
                    <div className="text-[#8696a0] uppercase tracking-wider text-[9px]">
                      Contexto simulado
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-[#e9edef]">
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
                        placeholder="Nombre"
                        className="w-full bg-black/30 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-[#e9edef] focus:outline-none focus:border-[--color-cyan]/40"
                      />
                    )}
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-[#e9edef] font-mono focus:outline-none focus:border-[--color-cyan]/40"
                    />
                  </div>
                )}

                <button
                  onClick={() => {
                    reset();
                    setShowSettings(false);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-[#aebac1] hover:text-white hover:bg-white/5 transition"
                >
                  <RotateCcw size={11} />
                  Reiniciar conversación
                </button>
              </div>
            )}

            {/* Mensajes */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5"
              style={{
                backgroundColor: '#0b141a',
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><path d='M20 20 Q30 10 40 20 T60 20' stroke='%23ffffff' stroke-opacity='0.018' fill='none' stroke-width='1'/><path d='M0 50 Q15 40 30 50 T60 50 T90 50' stroke='%23ffffff' stroke-opacity='0.015' fill='none' stroke-width='1'/></svg>\")",
              }}
            >
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <div className="w-14 h-14 rounded-full bg-[--color-cyan]/10 border border-[--color-cyan]/20 flex items-center justify-center mb-3">
                    <Send size={18} className="text-[--color-cyan]" />
                  </div>
                  <p className="text-[#e9edef] text-sm font-medium">Empezá la conversación</p>
                  <p className="text-[#8696a0] text-xs mt-1">
                    Escribí como si fueras un huésped por WhatsApp
                  </p>
                </div>
              ) : (
                messages.map((m, i) => {
                  const isUser = m.role === 'user';
                  return (
                    <div
                      key={i}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`relative max-w-[78%] px-2 py-1 pb-[18px] rounded-lg text-sm shadow-sm ${
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
              <div className="px-3 py-2 bg-red-900/40 border-t border-red-500/30 text-[11px] text-red-200 font-mono">
                {error}
              </div>
            )}

            {/* Input bar */}
            <div className="bg-[#1f2c33] px-2 py-2 flex items-end gap-2 border-t border-black/20">
              <div className="flex-1 bg-[#2a3942] rounded-3xl px-4 py-2 flex items-center">
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
        </div>
      </div>

      {/* Hint bajo el teléfono */}
      <div className="flex items-center justify-center gap-2 text-[11px] text-[--color-text-dim] font-mono">
        <Settings size={11} />
        <span>
          {mode === 'isolated'
            ? `Modo aislado · ${activeAgentLabel}`
            : `Flujo completo · ${hasReservation ? 'con reserva' : 'sin reserva'}`}
        </span>
      </div>
    </div>
  );
}
