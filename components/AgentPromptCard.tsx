'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Check, Loader2, ChevronDown } from 'lucide-react';

type Prompt = {
  agent_key: string;
  display_name: string;
  description: string | null;
  system_prompt: string;
  updated_at: string;
  updated_by: string | null;
};

export function AgentPromptCard({ prompt, userEmail }: { prompt: Prompt; userEmail: string }) {
  const [draft, setDraft] = useState(prompt.system_prompt);
  const [saved, setSaved] = useState(prompt.system_prompt);
  const [updatedAt, setUpdatedAt] = useState(prompt.updated_at);
  const [updatedBy, setUpdatedBy] = useState(prompt.updated_by);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const supabase = createClient();

  const dirty = draft !== saved;

  async function save() {
    setSaving(true);
    const { data, error } = await supabase
      .from('nlcn_agent_prompts')
      .update({ system_prompt: draft, updated_by: userEmail })
      .eq('agent_key', prompt.agent_key)
      .select()
      .single();
    if (!error && data) {
      setSaved(data.system_prompt);
      setUpdatedAt(data.updated_at);
      setUpdatedBy(data.updated_by);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    }
    setSaving(false);
  }

  function discard() {
    setDraft(saved);
  }

  return (
    <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
      {/* Header (clickable) */}
      <button
        onClick={() => setExpanded((x) => !x)}
        className="w-full p-6 flex items-center justify-between text-left hover:bg-white/[0.01] transition"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[--color-surface-elevated] border border-[--color-border] flex items-center justify-center font-mono text-xs text-[--color-text-muted]">
            {prompt.agent_key.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className="text-lg font-medium">{prompt.display_name}</h3>
            {prompt.description && (
              <p className="text-sm text-[--color-text-muted] mt-0.5">{prompt.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {dirty && (
            <span className="font-mono text-xs text-[--color-amber] flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-[--color-amber] shadow-[0_0_6px_var(--color-amber-glow)]" />
              sin guardar
            </span>
          )}
          <ChevronDown
            size={18}
            className={`text-[--color-text-dim] transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-6 pb-6 border-t border-[--color-border]/50">
          <div className="pt-5">
            <div className="flex items-center justify-between mb-3">
              <label className="font-mono text-xs uppercase tracking-wider text-[--color-text-dim]">
                System prompt
              </label>
              <span className="font-mono text-xs text-[--color-text-dim]">
                {draft.length.toLocaleString()} chars
              </span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={20}
              className="w-full bg-[--color-bg] border border-[--color-border] rounded-xl p-4 text-sm font-mono text-[--color-text] leading-relaxed resize-y focus:outline-none focus:border-[--color-cyan]/30 transition"
              spellCheck={false}
            />
            <p className="font-mono text-xs text-[--color-text-dim] mt-2">
              El contexto del huésped (nombre, reserva, teléfono) se inyecta automáticamente desde el workflow. No necesitás incluir esos datos acá.
            </p>
          </div>

          <div className="flex items-center justify-between mt-5 pt-5 border-t border-[--color-border]/40">
            <div className="font-mono text-xs text-[--color-text-dim]">
              Última edición: {new Date(updatedAt).toLocaleString('es-CR')}
              {updatedBy && ` · ${updatedBy}`}
            </div>
            <div className="flex items-center gap-2">
              {dirty && (
                <button
                  onClick={discard}
                  className="px-4 py-2 rounded-lg text-sm font-mono text-[--color-text-muted] hover:text-[--color-text] transition"
                >
                  descartar
                </button>
              )}
              <button
                onClick={save}
                disabled={!dirty || saving}
                className={`px-5 py-2 rounded-lg text-sm font-medium border transition flex items-center gap-2 ${
                  dirty && !saving
                    ? 'bg-[--color-surface-elevated] border-[--color-cyan]/30 hover:border-[--color-cyan]/50 hover:shadow-[0_0_16px_rgba(6,182,212,0.15)]'
                    : 'bg-[--color-surface] border-[--color-border] text-[--color-text-dim] cursor-not-allowed'
                }`}
              >
                {saving ? (
                  <><Loader2 size={14} className="animate-spin" /> Guardando</>
                ) : justSaved ? (
                  <><Check size={14} className="text-[--color-cyan]" /> Guardado</>
                ) : (
                  'Guardar cambios'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
