'use client';
import { useState } from 'react';
import { Check, History, Loader2, Wand2 } from 'lucide-react';
import { DiffView } from '@/components/DiffView';
import type { RuleRow } from '@/lib/reviews';
import type { PromptVersion } from '@/lib/prompt-versions';
import type { Prompt } from '@/components/AgentWorkspace';

type Preparado = { before: string; after: string; ruleIds: number[] };

export function PromptApply({
  prompts,
  rules,
  versiones,
  onCambio,
}: {
  prompts: Prompt[];
  rules: RuleRow[];
  versiones: Record<string, PromptVersion[]>;
  onCambio: () => void;
}) {
  const [agente, setAgente] = useState(prompts[0]?.agent_key || 'soporte');
  const [preparado, setPreparado] = useState<Preparado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);

  const pendientes = rules.filter((r) => r.agent_key === agente);
  const historial = versiones[agente] || [];

  async function preparar() {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch(`/api/prompts/${agente}/prepare`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo preparar el cambio');
      setPreparado({ before: body.before, after: body.after, ruleIds: body.ruleIds });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    if (!preparado) return;
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${agente}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: preparado.after, ruleIds: preparado.ruleIds }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo aplicar el cambio');
      setPreparado(null);
      setAviso(`Listo. El prompt de ${agente} quedó en la versión ${body.versionNumber}.`);
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setOcupado(false);
    }
  }

  async function restaurar(versionId: number, versionNumber: number) {
    if (!confirm(`¿Restaurar el prompt de ${agente} a la versión ${versionNumber}?`)) return;
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${agente}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo restaurar');
      setAviso(`Restaurado. El prompt quedó en la versión ${body.versionNumber}.`);
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="glass fade-up fade-up-2 p-5">
      <h2 className="text-[13px] text-[--color-cream] font-medium mb-1">Aplicar al prompt</h2>
      <p className="text-[12px] text-[--color-cream-mute] mb-4">
        Acá se ve el texto exacto que va a entrar al prompt del agente. Nada cambia hasta que lo
        apliques.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {prompts.map((p) => (
          <button
            key={p.agent_key}
            onClick={() => {
              setAgente(p.agent_key);
              setPreparado(null);
              setAviso(null);
              setError(null);
            }}
            className={`px-3.5 py-1.5 rounded-full text-[12px] transition ${
              agente === p.agent_key
                ? 'text-[--color-green-glow] bg-[--color-green-soft]'
                : 'text-[--color-cream-mute] hover:text-[--color-cream-dim] glass-pill'
            }`}
          >
            {p.display_name}
            {rules.filter((r) => r.agent_key === p.agent_key).length > 0 && (
              <span className="ml-1.5 text-[10.5px]">
                ({rules.filter((r) => r.agent_key === p.agent_key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {aviso && (
        <p className="glass-inset px-4 py-2.5 text-[12.5px] text-[--color-green-glow] mb-4">
          {aviso}
        </p>
      )}
      {error && <p className="glass-inset px-4 py-2.5 text-[12.5px] text-red-300 mb-4">{error}</p>}

      {pendientes.length === 0 ? (
        <p className="text-[13px] text-[--color-cream-mute] px-1 py-6 text-center">
          No hay reglas aprobadas esperando para este agente.
        </p>
      ) : (
        <div className="glass-inset p-4">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-[--color-cream-mute] mb-3">
            {pendientes.length} regla{pendientes.length === 1 ? '' : 's'} lista
            {pendientes.length === 1 ? '' : 's'} para integrar
          </h3>
          <ul className="flex flex-col gap-2">
            {pendientes.map((r) => (
              <li key={r.id} className="text-[12.5px] text-[--color-cream-dim] leading-relaxed">
                <strong className="text-[--color-cream]">{r.trigger_text}</strong> → {r.rule_text}
              </li>
            ))}
          </ul>

          {!preparado && (
            <button
              onClick={preparar}
              disabled={ocupado}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[12.5px] font-medium disabled:opacity-60"
              style={{
                background: 'linear-gradient(180deg, var(--color-green-glow), var(--color-green))',
                color: '#0a1c11',
              }}
            >
              {ocupado ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              Preparar cambio
            </button>
          )}
        </div>
      )}

      {preparado && (
        <div className="mt-4">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-[--color-cream-mute] mb-2">
            Esto es lo que va a cambiar
          </h3>
          <DiffView before={preparado.before} after={preparado.after} />
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={aplicar}
              disabled={ocupado}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[12.5px] font-medium disabled:opacity-60"
              style={{
                background: 'linear-gradient(180deg, var(--color-green-glow), var(--color-green))',
                color: '#0a1c11',
              }}
            >
              {ocupado ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Aplicar al prompt
            </button>
            <button
              onClick={() => setPreparado(null)}
              className="glass-pill inline-flex items-center px-4 py-2.5 rounded-full text-[12.5px] text-[--color-cream-dim] hover:text-[--color-cream] transition"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      <div className="mt-7">
        <button
          onClick={() => setVerHistorial((v) => !v)}
          className="glass-pill inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] text-[--color-cream-dim] hover:text-[--color-cream] transition"
        >
          <History size={14} />
          {verHistorial ? 'Ocultar historial' : `Historial (${historial.length})`}
        </button>

        {verHistorial && (
          <ul className="flex flex-col gap-2 mt-3">
            {historial.map((v, i) => (
              <li key={v.id} className="glass-inset px-4 py-3 flex flex-wrap items-center gap-3">
                <span className="text-[12.5px] text-[--color-cream] font-medium">
                  v{v.version_number}
                </span>
                <span className="text-[12px] text-[--color-cream-dim]">
                  {v.change_summary || '—'}
                </span>
                <span className="text-[11px] text-[--color-cream-faint]">
                  {new Date(v.created_at).toLocaleString('es-CR', {
                    timeZone: 'America/Costa_Rica',
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {v.created_by ? ` · ${v.created_by}` : ''}
                </span>
                {i === 0 ? (
                  <span className="ml-auto text-[11px] text-[--color-green-glow]">actual</span>
                ) : (
                  <button
                    onClick={() => restaurar(v.id, v.version_number)}
                    disabled={ocupado}
                    className="ml-auto glass-pill px-3.5 py-1.5 rounded-full text-[12px] text-[--color-cream-dim] hover:text-[--color-cream] transition disabled:opacity-60"
                  >
                    Restaurar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
