'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Check, Info, Loader2 } from 'lucide-react';

export type Prompt = {
  agent_key: string;
  display_name: string;
  description: string | null;
  system_prompt: string;
  updated_at: string;
  updated_by: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  soporte: 'Huéspedes',
  bigday: 'Avistamiento',
  ventas: 'Reservas',
};

function formatDate(d: string) {
  return new Date(d).toLocaleString('es-CR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AgentWorkspace({
  prompts,
  selectedKey,
  onSelect,
  onSaved,
  userEmail,
}: {
  prompts: Prompt[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onSaved: (key: string, newPrompt: string, updatedAt: string) => void;
  userEmail: string;
}) {
  const current = prompts.find((p) => p.agent_key === selectedKey) || prompts[0];
  const [draft, setDraft] = useState(current?.system_prompt || '');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    setDraft(current?.system_prompt || '');
    setJustSaved(false);
  }, [current?.agent_key, current?.updated_at, current?.system_prompt]);

  const dirty = draft !== (current?.system_prompt || '');

  async function save() {
    if (!current) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('nlcn_agent_prompts')
      .update({ system_prompt: draft, updated_by: userEmail })
      .eq('agent_key', current.agent_key)
      .select()
      .single();
    if (!error && data) {
      onSaved(current.agent_key, data.system_prompt, data.updated_at);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2200);
    }
    setSaving(false);
  }

  function discard() {
    setDraft(current?.system_prompt || '');
  }

  if (!current) return null;

  return (
    <section className="glass-lifted relative overflow-hidden">
      {/* Línea verde superior */}
      <div className="absolute top-0 left-[35%] right-[35%] h-px green-line opacity-60" />

      {/* Tabs */}
      <div
        role="tablist"
        className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 p-2"
        style={{
          background: 'rgba(0, 0, 0, 0.18)',
          boxShadow: '0 -1px 0 rgba(255,255,255,0.04) inset',
        }}
      >
        {prompts.map((p) => {
          const active = p.agent_key === selectedKey;
          return (
            <button
              key={p.agent_key}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(p.agent_key)}
              className="flex items-center gap-3 px-[18px] py-3.5 rounded-[14px] cursor-pointer transition-all duration-200 text-left relative"
              style={
                active
                  ? {
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))',
                      boxShadow:
                        '0 1px 0 rgba(255,255,255,0.16) inset, 0 -1px 0 rgba(0,0,0,0.2) inset, 0 0 0 1px rgba(255,255,255,0.06), 0 0 0 1px var(--color-green-soft)',
                    }
                  : { background: 'transparent' }
              }
            >
              <span
                className="w-[36px] h-[36px] grid place-items-center rounded-[11px] text-[11px] font-semibold tracking-wider transition-all"
                style={
                  active
                    ? {
                        background:
                          'linear-gradient(135deg, rgba(127, 184, 138, 0.22), rgba(127, 184, 138, 0.06))',
                        color: 'var(--color-green-glow)',
                        boxShadow:
                          '0 1px 0 rgba(255,255,255,0.18) inset, 0 0 0 1px var(--color-green-ring), 0 0 14px -4px var(--color-green-ring)',
                      }
                    : {
                        background:
                          'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                        color: 'var(--color-cream-mute)',
                        boxShadow:
                          '0 1px 0 rgba(255,255,255,0.08) inset, 0 0 0 1px rgba(255,255,255,0.04)',
                      }
                }
              >
                {p.agent_key.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="text-[16px] font-medium text-[--color-cream] tracking-tight truncate">
                  {p.display_name}
                </div>
                <div className="text-[10.5px] font-medium text-[--color-cream-mute] uppercase tracking-[0.14em] mt-px truncate">
                  {ROLE_LABEL[p.agent_key] || p.agent_key}
                </div>
              </div>
              {active && (
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
                  style={{
                    background: 'var(--color-green-glow)',
                    boxShadow: '0 0 10px var(--color-green-ring)',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="px-7 sm:px-9 py-8">
        {current.description && (
          <p className="text-[14.5px] font-normal text-[--color-cream-dim] leading-[1.55] max-w-[720px]">
            {current.description}
          </p>
        )}

        {/* Prompt label row */}
        <div className="flex items-center justify-between mt-7 mb-3">
          <span className="text-[11px] font-semibold text-[--color-cream-mute] uppercase tracking-[0.18em]">
            System Prompt
          </span>
          <span className="text-[11.5px] font-normal text-[--color-cream-faint]">
            <strong className="text-[--color-green-glow] font-semibold">
              {draft.length.toLocaleString()}
            </strong>{' '}
            caracteres
          </span>
        </div>

        {/* Textarea shell — inset glass */}
        <div className="glass-inset relative focus-within:[box-shadow:0_1px_0_rgba(255,255,255,0.08)_inset,_0_2px_4px_rgba(0,0,0,0.4)_inset,_0_0_0_1px_var(--color-green-ring),_0_0_0_4px_var(--color-green-soft)] transition-shadow duration-200">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={20}
            spellCheck={false}
            className="w-full min-h-[420px] max-h-[60vh] p-[22px_24px] bg-transparent border-none outline-none resize-y text-[--color-cream] text-[14px] font-normal leading-[1.75] tracking-[-0.005em] whitespace-pre-wrap"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          />
        </div>

        {/* Helper con acento verde */}
        <div
          className="mt-[18px] flex items-start gap-3 px-[18px] py-[14px] rounded-[12px] text-[13px] leading-[1.55] text-[--color-cream-dim] relative overflow-hidden"
          style={{
            background:
              'linear-gradient(180deg, rgba(127,184,138,0.06), rgba(127,184,138,0.015))',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.06) inset, 0 0 0 1px rgba(127,184,138,0.12)',
          }}
        >
          <span
            className="absolute left-0 top-0 bottom-0 w-[2px]"
            style={{
              background:
                'linear-gradient(180deg, transparent, var(--color-green-glow), transparent)',
            }}
          />
          <Info size={16} className="shrink-0 mt-[1px]" style={{ color: 'var(--color-green-glow)' }} />
          <span>
            El contexto del huésped (nombre, reserva, teléfono) se inyecta automáticamente desde el workflow.
          </span>
        </div>

        {/* Footer */}
        <div
          className="mt-[26px] pt-[22px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset' }}
        >
          <div className="text-[11.5px] font-normal text-[--color-cream-faint] tracking-[0.02em]">
            Última edición: {formatDate(current.updated_at)}
            {current.updated_by && (
              <span
                className="inline-block ml-2 px-2 py-[3px] rounded-md text-[10.5px] font-medium text-[--color-cream-mute] glass-pill"
              >
                {current.updated_by}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={discard}
                className="px-4 py-2 rounded-[10px] text-[12.5px] font-medium text-[--color-cream-mute] hover:text-[--color-cream] transition"
              >
                Descartar
              </button>
            )}
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="px-[26px] py-3 rounded-[14px] text-[13.5px] font-semibold cursor-pointer transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center gap-2"
              style={
                dirty && !saving
                  ? {
                      background:
                        'linear-gradient(180deg, var(--color-green-glow), var(--color-green))',
                      color: '#0a1c11',
                      letterSpacing: '-0.005em',
                      boxShadow:
                        '0 1px 0 rgba(255,255,255,0.4) inset, 0 -1px 0 rgba(0,0,0,0.18) inset, 0 8px 24px -6px var(--color-green-ring), 0 0 0 1px rgba(127,184,138,0.5)',
                    }
                  : {
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
                      color: 'var(--color-cream-mute)',
                      boxShadow:
                        '0 1px 0 rgba(255,255,255,0.06) inset, 0 0 0 1px rgba(255,255,255,0.04)',
                    }
              }
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Guardando
                </>
              ) : justSaved ? (
                <>
                  <Check size={14} /> Guardado
                </>
              ) : (
                'Guardar cambios'
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
