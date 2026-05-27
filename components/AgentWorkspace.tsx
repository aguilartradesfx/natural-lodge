'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Check, Loader2 } from 'lucide-react';

export type Prompt = {
  agent_key: string;
  display_name: string;
  description: string | null;
  system_prompt: string;
  updated_at: string;
  updated_by: string | null;
};

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

  // Sincronizar el draft cuando cambia el agente seleccionado o llega un update externo
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
    <div className="rounded-2xl bg-[--color-surface]/60 border border-[--color-border] overflow-hidden">
      {/* Tabs */}
      <div role="tablist" className="flex border-b border-[--color-border] bg-[--color-bg]/40">
        {prompts.map((p) => {
          const active = p.agent_key === selectedKey;
          return (
            <button
              key={p.agent_key}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(p.agent_key)}
              className={`flex-1 px-5 py-3.5 text-left transition relative ${
                active
                  ? 'bg-[--color-surface]/80'
                  : 'hover:bg-[--color-surface]/40 text-[--color-text-muted]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`font-mono text-[10px] uppercase tracking-wider w-7 h-7 rounded-md flex items-center justify-center ${
                    active
                      ? 'bg-[--color-cyan]/15 text-[--color-cyan] border border-[--color-cyan]/30'
                      : 'bg-[--color-surface-elevated] text-[--color-text-dim] border border-[--color-border]'
                  }`}
                >
                  {p.agent_key.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className={`text-sm font-medium truncate ${active ? 'text-[--color-text]' : ''}`}>
                    {p.display_name}
                  </div>
                </div>
              </div>
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[--color-cyan] to-transparent" />
              )}
            </button>
          );
        })}
      </div>

      {/* Editor */}
      <div className="p-5">
        {current.description && (
          <p className="text-xs text-[--color-text-muted] mb-4">{current.description}</p>
        )}

        <div className="flex items-center justify-between mb-2">
          <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-[--color-text-dim]">
            System prompt
          </label>
          <span className="font-mono text-[10px] text-[--color-text-dim]">
            {draft.length.toLocaleString()} chars
          </span>
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={22}
          className="w-full bg-[--color-bg] border border-[--color-border] rounded-xl p-4 text-sm font-mono text-[--color-text] leading-relaxed resize-y focus:outline-none focus:border-[--color-cyan]/40 transition"
          spellCheck={false}
        />

        <p className="text-[11px] text-[--color-text-dim] mt-2 leading-relaxed">
          El contexto del huésped (nombre, reserva, teléfono) se inyecta automáticamente desde el workflow.
        </p>

        <div className="flex items-center justify-between mt-5 pt-4 border-t border-[--color-border]">
          <div className="text-[11px] text-[--color-text-dim]">
            Última edición:{' '}
            {new Date(current.updated_at).toLocaleString('es-CR', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {current.updated_by && ` · ${current.updated_by}`}
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={discard}
                className="px-3 py-1.5 rounded-md text-xs text-[--color-text-muted] hover:text-[--color-text] transition"
              >
                Descartar
              </button>
            )}
            <button
              onClick={save}
              disabled={!dirty || saving}
              className={`px-4 py-1.5 rounded-md text-xs font-medium border transition flex items-center gap-1.5 ${
                dirty && !saving
                  ? 'bg-[--color-cyan]/15 border-[--color-cyan]/40 text-[--color-cyan-glow] hover:bg-[--color-cyan]/25'
                  : 'bg-[--color-surface] border-[--color-border] text-[--color-text-dim] cursor-not-allowed'
              }`}
            >
              {saving ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Guardando
                </>
              ) : justSaved ? (
                <>
                  <Check size={12} /> Guardado
                </>
              ) : (
                'Guardar cambios'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
