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
      {/* Step 1 */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-5 h-5 rounded-full bg-[--color-cyan]/15 text-[--color-cyan] text-[11px] font-semibold flex items-center justify-center">
            1
          </span>
          <h3 className="text-sm font-medium">¿Qué querés agregar o cambiar?</h3>
        </div>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder='Ej: "Cuando un huésped pregunte por mascotas, decile que solo aceptamos perros menores de 10kg con previo aviso."'
          className="w-full bg-[--color-bg] border border-[--color-border] rounded-lg p-3 text-sm leading-relaxed resize-y focus:outline-none focus:border-[--color-cyan]/40 transition"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={generate}
            disabled={!instruction.trim() || generating}
            className="px-3.5 py-1.5 rounded-md text-xs font-medium border bg-[--color-cyan]/15 border-[--color-cyan]/40 text-[--color-cyan-glow] hover:bg-[--color-cyan]/25 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1.5"
          >
            {generating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            {generating ? 'Generando' : 'Generar fragmento'}
          </button>
        </div>
      </section>

      {/* Step 2 */}
      {fragment && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-5 h-5 rounded-full bg-[--color-cyan]/15 text-[--color-cyan] text-[11px] font-semibold flex items-center justify-center">
              2
            </span>
            <h3 className="text-sm font-medium">Fragmento generado · editable</h3>
          </div>
          <textarea
            value={fragment}
            onChange={(e) => setFragment(e.target.value)}
            rows={8}
            className="w-full bg-[--color-bg] border border-[--color-border] rounded-lg p-3 text-sm font-mono leading-relaxed resize-y focus:outline-none focus:border-[--color-cyan]/40 transition"
            spellCheck={false}
          />
        </section>
      )}

      {/* Step 3 */}
      {fragment && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-5 h-5 rounded-full bg-[--color-cyan]/15 text-[--color-cyan] text-[11px] font-semibold flex items-center justify-center">
              3
            </span>
            <h3 className="text-sm font-medium">Inyectar en</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {prompts.map((p) => {
              const on = !!selected[p.agent_key];
              return (
                <button
                  key={p.agent_key}
                  onClick={() => toggle(p.agent_key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition flex items-center gap-2 ${
                    on
                      ? 'bg-[--color-cyan]/15 border-[--color-cyan]/40 text-[--color-cyan-glow]'
                      : 'bg-[--color-surface-elevated] border-[--color-border] text-[--color-text-muted] hover:border-[--color-border-hover]'
                  }`}
                >
                  <span
                    className={`w-3 h-3 rounded-sm border flex items-center justify-center ${
                      on
                        ? 'bg-[--color-cyan]/30 border-[--color-cyan]/60'
                        : 'border-[--color-border]'
                    }`}
                  >
                    {on && <Check size={9} className="text-[--color-cyan-glow]" />}
                  </span>
                  {p.display_name}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end mt-3">
            <button
              onClick={buildMerges}
              disabled={selectedKeys.length === 0 || merging}
              className="px-3.5 py-1.5 rounded-md text-xs font-medium border bg-[--color-cyan]/15 border-[--color-cyan]/40 text-[--color-cyan-glow] hover:bg-[--color-cyan]/25 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1.5"
            >
              {merging ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <ArrowRight size={12} />
              )}
              {merging ? 'Calculando' : 'Previsualizar inserción'}
            </button>
          </div>
        </section>
      )}

      {/* Step 4 */}
      {merges.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-[--color-cyan]/15 text-[--color-cyan] text-[11px] font-semibold flex items-center justify-center">
              4
            </span>
            <h3 className="text-sm font-medium">Aprobá los cambios</h3>
          </div>
          {merges.map((m, idx) => {
            const display =
              prompts.find((p) => p.agent_key === m.agentKey)?.display_name || m.agentKey;
            return (
              <div
                key={m.agentKey}
                className="rounded-lg border border-[--color-border] bg-[--color-bg]/40 overflow-hidden"
              >
                <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-[--color-border]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[--color-text-dim]">
                      {m.agentKey}
                    </span>
                    <span className="text-xs font-medium">{display}</span>
                    {m.saved && (
                      <span className="text-[10px] text-[--color-cyan] flex items-center gap-1 font-mono">
                        <Check size={10} /> aplicado
                      </span>
                    )}
                  </div>
                  {!m.saved && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => discardMerge(idx)}
                        className="p-1 rounded text-[--color-text-muted] hover:text-[--color-text] transition"
                        title="Descartar"
                      >
                        <X size={12} />
                      </button>
                      <button
                        onClick={() => applyMerge(idx)}
                        disabled={m.applying}
                        className="px-2.5 py-1 rounded text-[11px] font-medium border border-[--color-cyan]/40 bg-[--color-cyan]/15 text-[--color-cyan-glow] hover:bg-[--color-cyan]/25 transition flex items-center gap-1 disabled:opacity-50"
                      >
                        {m.applying ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Check size={10} />
                        )}
                        Aplicar
                      </button>
                    </div>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  <DiffView before={m.before} after={m.after} />
                  {!m.saved && (
                    <details>
                      <summary className="text-[10px] text-[--color-text-dim] cursor-pointer hover:text-[--color-text-muted]">
                        Editar antes de aplicar
                      </summary>
                      <textarea
                        value={m.after}
                        onChange={(e) => editMergeAfter(idx, e.target.value)}
                        rows={12}
                        className="mt-2 w-full bg-[--color-bg] border border-[--color-border] rounded-md p-2.5 text-xs font-mono leading-relaxed resize-y focus:outline-none focus:border-[--color-cyan]/40"
                        spellCheck={false}
                      />
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {error && (
        <div className="px-3 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
