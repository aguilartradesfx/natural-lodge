'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, Loader2, Check, X, ArrowRight } from 'lucide-react';
import { DiffView } from './DiffView';

type Prompt = {
  agent_key: string;
  display_name: string;
  system_prompt: string;
};

type MergeResult = {
  agentKey: string;
  before: string;
  after: string;
  applying: boolean;
  saved: boolean;
};

const PRIMARY_BTN_STYLE_ACTIVE: React.CSSProperties = {
  background: 'linear-gradient(180deg, var(--color-green-glow), var(--color-green))',
  color: '#0a1c11',
  letterSpacing: '-0.005em',
  boxShadow:
    '0 1px 0 rgba(255,255,255,0.4) inset, 0 -1px 0 rgba(0,0,0,0.18) inset, 0 6px 18px -4px var(--color-green-ring), 0 0 0 1px rgba(127,184,138,0.5)',
};

const PRIMARY_BTN_STYLE_DISABLED: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
  color: 'var(--color-cream-mute)',
  boxShadow:
    '0 1px 0 rgba(255,255,255,0.06) inset, 0 0 0 1px rgba(255,255,255,0.04)',
};

/**
 * Botón con estado de loading: oculta el contenido original con opacity-0
 * y superpone un spinner centrado, sin layout shift ni texto traslapado.
 */
function ActionButton({
  onClick,
  disabled,
  loading,
  icon,
  children,
  variant = 'primary',
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  variant?: 'primary' | 'ghost';
}) {
  const isDisabled = disabled || loading;

  if (variant === 'ghost') {
    return (
      <button
        onClick={onClick}
        disabled={isDisabled}
        className="relative px-3 py-1.5 rounded-[10px] text-xs font-semibold text-[--color-cream-dim] hover:text-[--color-cream] disabled:opacity-40 disabled:cursor-not-allowed transition glass-pill"
      >
        <span
          className={`inline-flex items-center gap-1.5 transition-opacity ${
            loading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {icon}
          {children}
        </span>
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={12} className="animate-spin text-[--color-green-glow]" />
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className="relative px-4 py-2 rounded-[12px] text-[12.5px] font-semibold cursor-pointer transition-all duration-200 disabled:cursor-not-allowed inline-flex items-center"
      style={isDisabled && !loading ? PRIMARY_BTN_STYLE_DISABLED : PRIMARY_BTN_STYLE_ACTIVE}
    >
      <span
        className={`inline-flex items-center gap-1.5 transition-opacity ${
          loading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {icon}
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={13} className="animate-spin" style={{ color: '#0a1c11' }} />
        </span>
      )}
    </button>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span
      className="w-6 h-6 rounded-full text-[11px] font-semibold inline-flex items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, rgba(127,184,138,0.22), rgba(127,184,138,0.06))',
        color: 'var(--color-green-glow)',
        boxShadow:
          '0 1px 0 rgba(255,255,255,0.18) inset, 0 0 0 1px var(--color-green-ring), 0 0 10px -3px var(--color-green-ring)',
      }}
    >
      {n}
    </span>
  );
}

export function PromptAssistant({
  prompts,
  userEmail,
  initialTargets,
  onSaved,
}: {
  prompts: Prompt[];
  userEmail: string;
  initialTargets?: string[];
  onSaved?: (agentKey: string, newPrompt: string, updatedAt: string) => void;
}) {
  const supabase = createClient();
  const [instruction, setInstruction] = useState('');
  const [fragment, setFragment] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>(
    () => Object.fromEntries((initialTargets || []).map((k) => [k, true])),
  );
  const [generating, setGenerating] = useState(false);
  const [merging, setMerging] = useState(false);
  const [merges, setMerges] = useState<MergeResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: string) => setSelected((s) => ({ ...s, [key]: !s[key] }));
  const selectedKeys = Object.keys(selected).filter((k) => selected[k]);

  async function generate() {
    setError(null);
    setGenerating(true);
    setMerges([]);
    try {
      const res = await fetch('/api/prompt-assistant/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, targetAgents: selectedKeys }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error generando fragmento');
      setFragment(data.fragment);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setGenerating(false);
    }
  }

  async function buildMerges() {
    if (selectedKeys.length === 0 || !fragment.trim()) return;
    setError(null);
    setMerging(true);
    setMerges([]);

    try {
      const results = await Promise.all(
        selectedKeys.map(async (agentKey) => {
          const current =
            prompts.find((p) => p.agent_key === agentKey)?.system_prompt || '';
          const res = await fetch('/api/prompt-assistant/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentKey, fragment, currentPrompt: current }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `Error mergeando ${agentKey}`);
          return {
            agentKey,
            before: current,
            after: data.mergedPrompt as string,
            applying: false,
            saved: false,
          };
        }),
      );
      setMerges(results);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setMerging(false);
    }
  }

  async function applyMerge(idx: number) {
    const m = merges[idx];
    setMerges((arr) => arr.map((x, i) => (i === idx ? { ...x, applying: true } : x)));
    const { data, error: dbErr } = await supabase
      .from('nlcn_agent_prompts')
      .update({ system_prompt: m.after, updated_by: userEmail })
      .eq('agent_key', m.agentKey)
      .select()
      .single();
    if (dbErr || !data) {
      setError(`Error guardando ${m.agentKey}: ${dbErr?.message || 'desconocido'}`);
      setMerges((arr) => arr.map((x, i) => (i === idx ? { ...x, applying: false } : x)));
      return;
    }
    setMerges((arr) =>
      arr.map((x, i) => (i === idx ? { ...x, applying: false, saved: true } : x)),
    );
    onSaved?.(m.agentKey, data.system_prompt, data.updated_at);
  }

  function discardMerge(idx: number) {
    setMerges((arr) => arr.filter((_, i) => i !== idx));
  }

  function editMergeAfter(idx: number, value: string) {
    setMerges((arr) => arr.map((x, i) => (i === idx ? { ...x, after: value } : x)));
  }

  return (
    <div className="p-6 space-y-6">
      {/* Step 1 — Instrucción */}
      <section>
        <div className="flex items-center gap-2.5 mb-3">
          <StepBadge n={1} />
          <h3 className="text-[13.5px] font-semibold text-[--color-cream]">
            ¿Qué querés agregar o cambiar?
          </h3>
        </div>
        <div className="glass-inset focus-within:[box-shadow:0_1px_0_rgba(255,255,255,0.08)_inset,_0_2px_4px_rgba(0,0,0,0.4)_inset,_0_0_0_1px_var(--color-green-ring),_0_0_0_4px_var(--color-green-soft)] transition-shadow duration-200">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder='Ej: "Cuando un huésped pregunte por mascotas, decile que solo aceptamos perros menores de 10kg con previo aviso."'
            className="w-full bg-transparent border-none outline-none p-3.5 text-[13.5px] font-normal leading-relaxed text-[--color-cream] placeholder:text-[--color-cream-faint] resize-y"
          />
        </div>
        <div className="flex justify-end mt-3">
          <ActionButton
            onClick={generate}
            disabled={!instruction.trim()}
            loading={generating}
            icon={<Sparkles size={12} />}
          >
            Generar fragmento
          </ActionButton>
        </div>
      </section>

      {/* Step 2 — Fragmento */}
      {fragment && (
        <section>
          <div className="flex items-center gap-2.5 mb-3">
            <StepBadge n={2} />
            <h3 className="text-[13.5px] font-semibold text-[--color-cream]">
              Fragmento generado · editable
            </h3>
          </div>
          <div className="glass-inset focus-within:[box-shadow:0_1px_0_rgba(255,255,255,0.08)_inset,_0_2px_4px_rgba(0,0,0,0.4)_inset,_0_0_0_1px_var(--color-green-ring),_0_0_0_4px_var(--color-green-soft)] transition-shadow duration-200">
            <textarea
              value={fragment}
              onChange={(e) => setFragment(e.target.value)}
              rows={8}
              className="w-full bg-transparent border-none outline-none p-3.5 text-[13.5px] font-normal leading-relaxed text-[--color-cream] resize-y"
              spellCheck={false}
            />
          </div>
        </section>
      )}

      {/* Step 3 — Targets */}
      {fragment && (
        <section>
          <div className="flex items-center gap-2.5 mb-3">
            <StepBadge n={3} />
            <h3 className="text-[13.5px] font-semibold text-[--color-cream]">Inyectar en</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {prompts.map((p) => {
              const on = !!selected[p.agent_key];
              return (
                <button
                  key={p.agent_key}
                  onClick={() => toggle(p.agent_key)}
                  className="glass-pill px-3.5 py-2 rounded-full text-[12.5px] font-medium transition-all duration-200 hover:-translate-y-[1px] flex items-center gap-2"
                  style={
                    on
                      ? {
                          background:
                            'linear-gradient(180deg, rgba(127,184,138,0.18), rgba(127,184,138,0.06))',
                          color: 'var(--color-green-glow)',
                          boxShadow:
                            '0 1px 0 rgba(255,255,255,0.18) inset, 0 -1px 0 rgba(0,0,0,0.2) inset, 0 0 0 1px var(--color-green-ring), 0 0 12px -4px var(--color-green-ring)',
                        }
                      : {
                          color: 'var(--color-cream-mute)',
                        }
                  }
                >
                  <span
                    className="w-3.5 h-3.5 rounded-[5px] flex items-center justify-center transition"
                    style={
                      on
                        ? {
                            background: 'var(--color-green-glow)',
                            boxShadow: '0 0 0 1px var(--color-green-ring)',
                          }
                        : {
                            background: 'rgba(255,255,255,0.05)',
                            boxShadow: '0 0 0 1px rgba(255,255,255,0.08)',
                          }
                    }
                  >
                    {on && <Check size={9} style={{ color: '#0a1c11' }} strokeWidth={3} />}
                  </span>
                  {p.display_name}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end mt-4">
            <ActionButton
              onClick={buildMerges}
              disabled={selectedKeys.length === 0}
              loading={merging}
              icon={<ArrowRight size={12} />}
            >
              Previsualizar inserción
            </ActionButton>
          </div>
        </section>
      )}

      {/* Step 4 — Diff previews */}
      {merges.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2.5">
            <StepBadge n={4} />
            <h3 className="text-[13.5px] font-semibold text-[--color-cream]">
              Aprobá los cambios
            </h3>
          </div>
          {merges.map((m, idx) => {
            const display =
              prompts.find((p) => p.agent_key === m.agentKey)?.display_name || m.agentKey;
            return (
              <div key={m.agentKey} className="glass overflow-hidden">
                <div
                  className="relative px-4 py-3 flex items-center justify-between"
                  style={{ boxShadow: '0 -1px 0 rgba(255,255,255,0.04) inset' }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[--color-cream-mute]">
                      {m.agentKey}
                    </span>
                    <span className="text-[13px] font-medium text-[--color-cream]">
                      {display}
                    </span>
                    {m.saved && (
                      <span
                        className="text-[10.5px] font-semibold flex items-center gap-1 px-2 py-0.5 rounded-full"
                        style={{
                          color: 'var(--color-green-glow)',
                          background: 'var(--color-green-soft)',
                          boxShadow: '0 0 0 1px var(--color-green-ring)',
                        }}
                      >
                        <Check size={10} /> aplicado
                      </span>
                    )}
                  </div>
                  {!m.saved && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => discardMerge(idx)}
                        className="p-1.5 rounded-[8px] text-[--color-cream-mute] hover:text-[--color-cream] transition glass-pill"
                        title="Descartar"
                      >
                        <X size={12} />
                      </button>
                      <ActionButton
                        variant="ghost"
                        onClick={() => applyMerge(idx)}
                        loading={m.applying}
                        icon={<Check size={11} />}
                      >
                        Aplicar
                      </ActionButton>
                    </div>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <DiffView before={m.before} after={m.after} />
                  {!m.saved && (
                    <details>
                      <summary className="text-[11px] font-medium text-[--color-cream-mute] cursor-pointer hover:text-[--color-cream] transition select-none">
                        Editar antes de aplicar
                      </summary>
                      <div className="glass-inset mt-2 focus-within:[box-shadow:0_1px_0_rgba(255,255,255,0.08)_inset,_0_2px_4px_rgba(0,0,0,0.4)_inset,_0_0_0_1px_var(--color-green-ring),_0_0_0_4px_var(--color-green-soft)] transition-shadow duration-200">
                        <textarea
                          value={m.after}
                          onChange={(e) => editMergeAfter(idx, e.target.value)}
                          rows={12}
                          className="w-full bg-transparent border-none outline-none p-3 text-[12.5px] font-normal leading-relaxed text-[--color-cream] resize-y"
                          spellCheck={false}
                        />
                      </div>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {error && (
        <div
          className="px-4 py-3 rounded-[12px] text-[12.5px] font-medium text-red-300"
          style={{
            background:
              'linear-gradient(180deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.06) inset, 0 0 0 1px rgba(239,68,68,0.32)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
