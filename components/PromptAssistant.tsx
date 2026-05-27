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

export function PromptAssistant({
  prompts,
  userEmail,
  onSaved,
}: {
  prompts: Prompt[];
  userEmail: string;
  onSaved?: (agentKey: string, newPrompt: string) => void;
}) {
  const supabase = createClient();
  const [instruction, setInstruction] = useState('');
  const [fragment, setFragment] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
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
          const current = prompts.find((p) => p.agent_key === agentKey)?.system_prompt || '';
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
    const { error: dbErr } = await supabase
      .from('nlcn_agent_prompts')
      .update({ system_prompt: m.after, updated_by: userEmail })
      .eq('agent_key', m.agentKey);
    if (dbErr) {
      setError(`Error guardando ${m.agentKey}: ${dbErr.message}`);
      setMerges((arr) => arr.map((x, i) => (i === idx ? { ...x, applying: false } : x)));
      return;
    }
    setMerges((arr) =>
      arr.map((x, i) => (i === idx ? { ...x, applying: false, saved: true } : x)),
    );
    onSaved?.(m.agentKey, m.after);
  }

  function discardMerge(idx: number) {
    setMerges((arr) => arr.filter((_, i) => i !== idx));
  }

  function editMergeAfter(idx: number, value: string) {
    setMerges((arr) => arr.map((x, i) => (i === idx ? { ...x, after: value } : x)));
  }

  return (
    <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 relative overflow-hidden">
      <div className="absolute -top-24 -left-24 w-64 h-64 bg-[--color-amber]/[0.06] rounded-full blur-3xl pointer-events-none" />

      <div className="flex items-center gap-3 mb-2 relative">
        <Sparkles size={16} className="text-[--color-amber]" />
        <span className="font-mono text-xs uppercase tracking-widest text-[--color-text-dim]">
          Asistente de prompts
        </span>
      </div>
      <h2 className="text-xl font-medium mb-1 relative">Generá fragmentos y inyectalos</h2>
      <p className="text-sm text-[--color-text-muted] mb-5 relative">
        Describí lo que querés cambiar o agregar. Claude arma el fragmento y lo integra en los cerebros que elijas.
      </p>

      {/* Step 1: instruction */}
      <div className="mb-4 relative">
        <label className="font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-2 block">
          1 · Tu idea o instrucción
        </label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={4}
          placeholder='Ej: "Cuando un huésped pregunte por mascotas, decile que solo aceptamos perros menores de 10kg con previo aviso."'
          className="w-full bg-[--color-bg] border border-[--color-border] rounded-xl p-3 text-sm text-[--color-text] leading-relaxed resize-y focus:outline-none focus:border-[--color-amber]/40 transition"
        />
        <div className="flex items-center justify-end mt-3">
          <button
            onClick={generate}
            disabled={!instruction.trim() || generating}
            className="px-4 py-2 rounded-lg text-sm font-medium border bg-[--color-surface-elevated] border-[--color-amber]/30 hover:border-[--color-amber]/60 hover:shadow-[0_0_16px_rgba(245,158,11,0.18)] disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? 'Generando' : 'Generar fragmento'}
          </button>
        </div>
      </div>

      {/* Step 2: fragment */}
      {fragment && (
        <div className="mb-4 relative">
          <label className="font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-2 block">
            2 · Fragmento generado (editable)
          </label>
          <textarea
            value={fragment}
            onChange={(e) => setFragment(e.target.value)}
            rows={8}
            className="w-full bg-[--color-bg] border border-[--color-border] rounded-xl p-3 text-sm font-mono text-[--color-text] leading-relaxed resize-y focus:outline-none focus:border-[--color-cyan]/30 transition"
            spellCheck={false}
          />
        </div>
      )}

      {/* Step 3: agents */}
      {fragment && (
        <div className="mb-4 relative">
          <label className="font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-2 block">
            3 · Inyectar en
          </label>
          <div className="flex flex-wrap gap-2">
            {prompts.map((p) => {
              const on = !!selected[p.agent_key];
              return (
                <button
                  key={p.agent_key}
                  onClick={() => toggle(p.agent_key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-mono border transition flex items-center gap-2 ${
                    on
                      ? 'bg-[--color-cyan]/15 border-[--color-cyan]/40 text-[--color-cyan-glow]'
                      : 'bg-[--color-surface] border-[--color-border] text-[--color-text-muted] hover:border-[--color-border-hover]'
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                      on
                        ? 'bg-[--color-cyan]/30 border-[--color-cyan]/60'
                        : 'border-[--color-border]'
                    }`}
                  >
                    {on && <Check size={10} className="text-[--color-cyan-glow]" />}
                  </span>
                  {p.display_name}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end mt-4">
            <button
              onClick={buildMerges}
              disabled={selectedKeys.length === 0 || merging}
              className="px-4 py-2 rounded-lg text-sm font-medium border bg-[--color-surface-elevated] border-[--color-cyan]/30 hover:border-[--color-cyan]/60 hover:shadow-[0_0_16px_rgba(6,182,212,0.18)] disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              {merging ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {merging ? 'Calculando merges' : 'Previsualizar inserción'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: diff previews */}
      {merges.length > 0 && (
        <div className="mt-6 space-y-5 relative">
          <div className="font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-1">
            4 · Aprobá los cambios
          </div>
          {merges.map((m, idx) => {
            const agentDisplay =
              prompts.find((p) => p.agent_key === m.agentKey)?.display_name || m.agentKey;
            return (
              <div
                key={m.agentKey}
                className="rounded-xl border border-[--color-border] bg-[--color-surface]/40 overflow-hidden"
              >
                <div className="px-4 py-3 flex items-center justify-between border-b border-[--color-border]/60">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-[--color-text-dim] uppercase">
                      {m.agentKey}
                    </span>
                    <span className="text-sm font-medium">{agentDisplay}</span>
                    {m.saved && (
                      <span className="font-mono text-xs text-[--color-cyan] flex items-center gap-1">
                        <Check size={12} /> aplicado
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!m.saved && (
                      <>
                        <button
                          onClick={() => discardMerge(idx)}
                          className="p-1.5 rounded-md text-[--color-text-muted] hover:text-[--color-text] transition"
                          title="Descartar"
                        >
                          <X size={14} />
                        </button>
                        <button
                          onClick={() => applyMerge(idx)}
                          disabled={m.applying}
                          className="px-3 py-1.5 rounded-md text-xs font-medium border border-[--color-cyan]/30 bg-[--color-surface-elevated] hover:border-[--color-cyan]/60 transition flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {m.applying ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                          Aplicar
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <DiffView before={m.before} after={m.after} />
                  {!m.saved && (
                    <details>
                      <summary className="font-mono text-xs text-[--color-text-dim] cursor-pointer hover:text-[--color-text-muted]">
                        Editar resultado antes de aplicar
                      </summary>
                      <textarea
                        value={m.after}
                        onChange={(e) => editMergeAfter(idx, e.target.value)}
                        rows={14}
                        className="mt-2 w-full bg-[--color-bg] border border-[--color-border] rounded-lg p-3 text-xs font-mono text-[--color-text] leading-relaxed resize-y focus:outline-none focus:border-[--color-cyan]/30 transition"
                        spellCheck={false}
                      />
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mt-4 px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-300 font-mono relative">
          {error}
        </div>
      )}
    </div>
  );
}
