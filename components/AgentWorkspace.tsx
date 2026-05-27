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
    <section
      className="rounded-[22px] border border-[--color-glass-border] overflow-hidden"
      style={{
        background: 'var(--color-glass-1)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        boxShadow:
          '0 1px 0 var(--color-glass-highlight) inset, 0 40px 80px -30px rgba(0,0,0,0.5)',
      }}
    >
      {/* Tabs */}
      <div
        role="tablist"
        className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 p-2 border-b border-[--color-glass-border]"
        style={{ background: 'rgba(0,0,0,0.15)' }}
      >
        {prompts.map((p) => {
          const active = p.agent_key === selectedKey;
          return (
            <button
              key={p.agent_key}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(p.agent_key)}
              className={`flex items-center gap-3 px-[18px] py-3.5 rounded-[14px] cursor-pointer transition-all duration-200 border text-left ${
                active
                  ? 'border-[--color-glass-border-strong]'
                  : 'border-transparent hover:border-[--color-glass-border]'
              }`}
              style={{
                background: active ? 'var(--color-glass-3)' : 'transparent',
                boxShadow: active
                  ? '0 1px 0 var(--color-glass-highlight) inset, 0 0 0 1px rgba(255,255,255,0.06)'
                  : 'none',
              }}
            >
              <span
                className={`w-[34px] h-[34px] grid place-items-center rounded-[10px] font-mono text-[11px] font-medium tracking-wider transition-all`}
                style={{
                  background: active ? 'var(--color-accent-soft)' : 'var(--color-glass-2)',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: active
                    ? 'var(--color-accent-glow)'
                    : 'var(--color-glass-border)',
                  color: active ? 'var(--color-light-glow)' : 'var(--color-cream-mute)',
                }}
              >
                {p.agent_key.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="font-serif font-normal text-[16.5px] text-[--color-cream] tracking-tight truncate">
                  {p.display_name}
                </div>
                <div className="text-[11.5px] text-[--color-cream-mute] font-mono uppercase tracking-[0.05em] mt-px truncate">
                  {ROLE_LABEL[p.agent_key] || p.agent_key}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="px-9 py-8 sm:px-9">
        {current.description && (
          <p className="text-[14.5px] text-[--color-cream-dim] leading-[1.55] max-w-[720px]">
            {current.description}
          </p>
        )}

        {/* Prompt label row */}
        <div className="flex items-center justify-between mt-7 mb-3">
          <span className="font-mono text-[11px] text-[--color-cream-mute] uppercase tracking-[0.18em]">
            System Prompt
          </span>
          <span className="font-mono text-[11.5px] text-[--color-cream-faint]">
            <strong className="text-[--color-mid] font-medium">
              {draft.length.toLocaleString()}
            </strong>{' '}
            caracteres
          </span>
        </div>

        {/* Textarea shell */}
        <div
          className="relative rounded-[14px] border border-[--color-glass-border] overflow-hidden transition-colors duration-200 focus-within:border-[rgba(255,255,255,0.32)]"
          style={{
            background: 'rgba(0,0,0,0.35)',
            boxShadow:
              '0 1px 0 var(--color-glass-highlight) inset, 0 2px 0 rgba(0,0,0,0.3) inset',
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={20}
            spellCheck={false}
            className="w-full min-h-[420px] max-h-[60vh] p-[22px_24px] bg-transparent border-none outline-none resize-y text-[--color-cream] font-mono text-[13.5px] leading-[1.7] tracking-[-0.005em] whitespace-pre-wrap"
          />
        </div>

        {/* Helper */}
        <div
          className="mt-[18px] flex items-start gap-3 px-[18px] py-[14px] rounded-[10px] border border-[--color-glass-border] text-[13px] leading-[1.55] text-[--color-cream-dim]"
          style={{
            background: 'var(--color-glass-1)',
            borderLeftWidth: '2px',
            borderLeftColor: 'var(--color-light)',
          }}
        >
          <Info size={16} className="text-[--color-light] shrink-0 mt-[1px]" />
          <span>
            El contexto del huésped (nombre, reserva, teléfono) se inyecta automáticamente desde el workflow.
          </span>
        </div>

        {/* Footer */}
        <div className="mt-[26px] pt-[22px] border-t border-[--color-glass-border] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="font-mono text-[11.5px] text-[--color-cream-faint] tracking-[0.03em]">
            Última edición: {formatDate(current.updated_at)}
            {current.updated_by && (
              <span
                className="inline-block ml-2 px-2 py-[3px] rounded-md border border-[--color-glass-border] text-[10.5px] text-[--color-cream-mute]"
                style={{ background: 'var(--color-glass-2)' }}
              >
                {current.updated_by}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={discard}
                className="px-4 py-2 rounded-[10px] text-[12.5px] text-[--color-cream-mute] hover:text-[--color-cream] transition"
              >
                Descartar
              </button>
            )}
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="px-[26px] py-3 rounded-[12px] text-[13.5px] font-semibold cursor-pointer transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center gap-2"
              style={{
                background:
                  dirty && !saving
                    ? 'linear-gradient(180deg, #f5f5f5, #cfcfcf)'
                    : 'rgba(255,255,255,0.08)',
                color: dirty && !saving ? '#101012' : 'var(--color-cream-mute)',
                border: 'none',
                letterSpacing: '-0.005em',
                boxShadow:
                  dirty && !saving
                    ? '0 1px 0 rgba(255,255,255,0.4) inset, 0 -1px 0 rgba(0,0,0,0.15) inset, 0 8px 24px -6px var(--color-accent-glow), 0 0 0 1px rgba(255,255,255,0.35)'
                    : 'none',
              }}
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
