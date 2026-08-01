'use client';
import { useState } from 'react';
import { Check, Loader2, Pencil, X, AlertTriangle } from 'lucide-react';
import type { RuleRow } from '@/lib/reviews';

export function RulesQueue({ rules, onCambio }: { rules: RuleRow[]; onCambio: () => void }) {
  const nuevas = rules.filter((r) => r.kind === 'nueva');
  const conflictos = rules.filter((r) => r.kind === 'conflicto');

  return (
    <section className="glass fade-up fade-up-2 p-5">
      <h2 className="text-[13px] text-[--color-cream] font-medium mb-1">Reglas por revisar</h2>
      <p className="text-[12px] text-[--color-cream-mute] mb-4">
        Nada de esto toca al bot todavía. Aprobar una regla la deja lista para el siguiente paso.
      </p>

      {nuevas.length === 0 && conflictos.length === 0 && (
        <p className="text-[13px] text-[--color-cream-mute] px-1 py-6 text-center">
          No hay reglas pendientes. Aparecen acá cuando alguien deja un comentario al revisar una
          conversación.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {nuevas.map((r) => (
          <TarjetaRegla key={r.id} regla={r} onCambio={onCambio} />
        ))}
      </ul>

      {conflictos.length > 0 && (
        <>
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-[--color-cream-mute] mt-7 mb-2 flex items-center gap-2">
            <AlertTriangle size={13} />
            El bot desobedeció una regla que ya tenía
          </h3>
          <p className="text-[12px] text-[--color-cream-mute] mb-3">
            Estas no se pueden aprobar: el prompt ya las contiene. Agregarlas de nuevo solo lo
            infla. Lo que hay que revisar es por qué el bot no las siguió.
          </p>
          <ul className="flex flex-col gap-3">
            {conflictos.map((r) => (
              <TarjetaRegla key={r.id} regla={r} onCambio={onCambio} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function TarjetaRegla({ regla, onCambio }: { regla: RuleRow; onCambio: () => void }) {
  const [editando, setEditando] = useState(false);
  const [trigger, setTrigger] = useState(regla.trigger_text);
  const [texto, setTexto] = useState(regla.rule_text);
  const [motivo, setMotivo] = useState('');
  const [rechazando, setRechazando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esConflicto = regla.kind === 'conflicto';

  async function accionar(action: 'aprobar' | 'rechazar') {
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${regla.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'aprobar'
            ? { action, rule_text: texto, trigger_text: trigger }
            : { action, rejection_reason: motivo },
        ),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo actualizar la regla');
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="glass-inset p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <span className="text-[11px] uppercase tracking-[0.1em] text-[--color-cream-mute]">
          {regla.agent_key}
        </span>
        {regla.source_review_id && (
          <span className="text-[11px] text-[--color-cream-faint]">
            de la conversación #{regla.source_review_id}
          </span>
        )}
        <span className="ml-auto text-[11px] text-[--color-cream-faint]">
          {new Date(regla.created_at).toLocaleDateString('es-CR', {
            timeZone: 'America/Costa_Rica',
          })}
        </span>
      </div>

      {editando ? (
        <div className="flex flex-col gap-2">
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            className="w-full glass-inset px-3 py-2 text-[12.5px] text-[--color-cream] outline-none focus:ring-1 focus:ring-[--color-green-ring]"
          />
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            className="w-full glass-inset px-3 py-2 text-[12.5px] text-[--color-cream] leading-relaxed outline-none resize-y focus:ring-1 focus:ring-[--color-green-ring]"
          />
        </div>
      ) : (
        <>
          <p className="text-[12.5px] text-[--color-cream-dim] leading-relaxed">
            <strong className="text-[--color-cream]">Cuándo:</strong> {trigger}
          </p>
          <p className="text-[12.5px] text-[--color-cream-dim] leading-relaxed mt-1">
            <strong className="text-[--color-cream]">Qué debe hacer:</strong> {texto}
          </p>
        </>
      )}

      {regla.rationale && (
        <p className="text-[12px] text-[--color-cream-faint] italic mt-2">
          &ldquo;{regla.rationale}&rdquo;
        </p>
      )}

      {esConflicto && regla.conflict_excerpt && (
        <div className="mt-3 px-3 py-2" style={{ boxShadow: 'inset 2px 0 0 rgba(239,68,68,0.5)' }}>
          <p className="text-[11px] text-[--color-cream-mute] mb-1">Ya está en el prompt:</p>
          <p className="text-[12px] text-[--color-cream-dim] leading-relaxed whitespace-pre-wrap">
            {regla.conflict_excerpt}
          </p>
        </div>
      )}

      {rechazando && (
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="¿Por qué la rechazás? (opcional)"
          className="mt-3 w-full glass-inset px-3 py-2 text-[12px] text-[--color-cream-dim] outline-none focus:ring-1 focus:ring-[--color-green-ring]"
        />
      )}

      {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {!esConflicto && (
          <>
            <button
              onClick={() => accionar('aprobar')}
              disabled={ocupado}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-medium disabled:opacity-60"
              style={{
                background: 'linear-gradient(180deg, var(--color-green-glow), var(--color-green))',
                color: '#0a1c11',
              }}
            >
              {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {editando ? 'Guardar y aprobar' : 'Aprobar'}
            </button>
            <button
              onClick={() => setEditando((v) => !v)}
              className="glass-pill inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] text-[--color-cream-dim] hover:text-[--color-cream] transition"
            >
              <Pencil size={13} />
              {editando ? 'Cancelar edición' : 'Editar'}
            </button>
          </>
        )}
        <button
          onClick={() => (rechazando ? accionar('rechazar') : setRechazando(true))}
          disabled={ocupado}
          className="glass-pill inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] text-[--color-cream-dim] hover:text-red-300 transition disabled:opacity-60"
        >
          <X size={13} />
          {rechazando ? 'Confirmar rechazo' : 'Rechazar'}
        </button>
      </div>
    </li>
  );
}
