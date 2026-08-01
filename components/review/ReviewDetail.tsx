'use client';
import { useState } from 'react';
import { ArrowLeft, Loader2, ThumbsDown, ThumbsUp, RotateCw } from 'lucide-react';
import { SIGNAL_LABELS, type Signal } from '@/lib/conversation-episodes';
import type { AnchorInput, ReviewDetail } from '@/lib/reviews';

const CALIFICACIONES = [
  { valor: 'bien', etiqueta: 'Estuvo bien' },
  { valor: 'regular', etiqueta: 'Regular' },
  { valor: 'mal', etiqueta: 'Estuvo mal' },
] as const;

type Rating = (typeof CALIFICACIONES)[number]['valor'];

type ReglaGenerada = { trigger_text: string; rule_text: string; kind: string };

export function ReviewDetailPanel({
  detalle,
  onCerrar,
  onGuardado,
}: {
  detalle: ReviewDetail;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { review, logs } = detalle;

  const [rating, setRating] = useState<Rating | null>((review.human_rating as Rating) || null);
  const [comentario, setComentario] = useState(review.human_comment || '');
  const [anclajes, setAnclajes] = useState<Record<number, AnchorInput>>(() =>
    Object.fromEntries(detalle.anchors.map((a) => [a.chatbot_log_id, a])),
  );
  const [guardando, setGuardando] = useState(false);
  const [reintentando, setReintentando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reglaGenerada, setReglaGenerada] = useState<ReglaGenerada | null>(null);
  const [errorRegla, setErrorRegla] = useState<string | null>(null);

  function marcar(logId: number, verdict: 'bien' | 'mal') {
    setAnclajes((prev) => {
      const actual = prev[logId];
      const copia = { ...prev };
      // Volver a apretar el mismo pulgar quita la marca.
      if (actual?.verdict === verdict) delete copia[logId];
      else copia[logId] = { chatbot_log_id: logId, verdict, comment: actual?.comment ?? null };
      return copia;
    });
  }

  function comentarAnclaje(logId: number, texto: string) {
    setAnclajes((prev) => {
      const actual = prev[logId];
      if (!actual) return prev;
      return { ...prev, [logId]: { ...actual, comment: texto } };
    });
  }

  async function guardar() {
    if (!rating) {
      setError('Elegí una calificación antes de guardar.');
      return;
    }
    setGuardando(true);
    setError(null);
    setErrorRegla(null);
    setReglaGenerada(null);

    try {
      const res = await fetch(`/api/reviews/${review.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comentario, anchors: Object.values(anclajes) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo guardar');

      if (body.rule) setReglaGenerada(body.rule as ReglaGenerada);
      if (body.ruleError) setErrorRegla(body.ruleError as string);

      // Si no hubo nada que generar ni error, la revisión está cerrada.
      if (!body.rule && !body.ruleError) onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setGuardando(false);
    }
  }

  async function reintentarRegla() {
    setReintentando(true);
    setErrorRegla(null);
    try {
      const res = await fetch(`/api/reviews/${review.id}/retry-rule`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo generar la regla');
      if (body.rule) setReglaGenerada(body.rule as ReglaGenerada);
      else setErrorRegla('No había comentario para convertir en regla.');
    } catch (err) {
      setErrorRegla(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setReintentando(false);
    }
  }

  return (
    <section className="glass fade-up p-5">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <button
          onClick={onCerrar}
          className="glass-pill inline-flex items-center gap-2 px-3.5 py-[7px] rounded-full text-[--color-cream-dim] text-[12.5px] hover:text-[--color-cream] transition"
        >
          <ArrowLeft size={14} />
          Volver a la bandeja
        </button>
        <span className="text-[13px] text-[--color-cream] font-medium">{review.phone}</span>
        <span className="text-[11px] text-[--color-cream-mute] uppercase tracking-[0.1em]">
          {review.agente}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Izquierda: lo que entendió la IA */}
        <div className="glass-inset p-4">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-[--color-cream-mute] mb-3">
            Lo que entendió la IA
          </h3>
          <p className="text-[13px] text-[--color-cream-dim] leading-relaxed">
            {review.summary || 'Sin resumen'}
          </p>

          <dl className="mt-4 flex flex-col gap-2 text-[12px]">
            <div className="flex gap-2">
              <dt className="text-[--color-cream-faint] w-24 shrink-0">Desenlace</dt>
              <dd className="text-[--color-cream-dim]">{review.outcome || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[--color-cream-faint] w-24 shrink-0">Temas</dt>
              <dd className="text-[--color-cream-dim]">{review.topics.join(', ') || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[--color-cream-faint] w-24 shrink-0">Riesgo</dt>
              <dd className="text-[--color-cream-dim]">{review.risk_score} / 100</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[--color-cream-faint] w-24 shrink-0">Señales</dt>
              <dd className="text-[--color-cream-dim]">
                {review.signals.map((s: Signal) => SIGNAL_LABELS[s] ?? s).join(' · ') || 'ninguna'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Derecha: la conversación real */}
        <div className="glass-inset p-4 max-h-[520px] overflow-y-auto">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-[--color-cream-mute] mb-3">
            La conversación
          </h3>
          <div className="flex flex-col gap-4">
            {logs.map((l) => {
              const marca = anclajes[l.id];
              return (
                <div key={l.id} className="flex flex-col gap-1.5">
                  {l.message_in && (
                    <p className="text-[12.5px] text-[--color-cream-dim] leading-relaxed">
                      <span className="text-[--color-cream-faint]">Huésped: </span>
                      {l.message_in}
                    </p>
                  )}
                  {l.message_out && (
                    <div
                      className="pl-3 py-1"
                      style={{
                        boxShadow: marca
                          ? `inset 2px 0 0 ${marca.verdict === 'mal' ? 'rgba(239,68,68,0.6)' : 'var(--color-green-ring)'}`
                          : 'inset 2px 0 0 var(--color-glass-border)',
                      }}
                    >
                      <p className="text-[12.5px] text-[--color-cream] leading-relaxed">
                        <span className="text-[--color-cream-faint]">Bot: </span>
                        {l.message_out}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <BotonMarca
                          activo={marca?.verdict === 'bien'}
                          onClick={() => marcar(l.id, 'bien')}
                        >
                          <ThumbsUp size={12} />
                        </BotonMarca>
                        <BotonMarca
                          activo={marca?.verdict === 'mal'}
                          onClick={() => marcar(l.id, 'mal')}
                        >
                          <ThumbsDown size={12} />
                        </BotonMarca>
                      </div>
                      {marca && (
                        <input
                          value={marca.comment ?? ''}
                          onChange={(e) => comentarAnclaje(l.id, e.target.value)}
                          placeholder="¿Qué pasó con esta respuesta?"
                          className="mt-1.5 w-full bg-transparent border-0 border-b border-[--color-glass-border] text-[12px] text-[--color-cream-dim] py-1 outline-none focus:border-[--color-green-ring]"
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Calificación y comentario */}
      <div className="glass-inset p-4 mt-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[12px] text-[--color-cream-mute] mr-1">¿Cómo estuvo?</span>
          {CALIFICACIONES.map((c) => (
            <button
              key={c.valor}
              onClick={() => setRating(c.valor)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] transition ${
                rating === c.valor
                  ? 'text-[--color-green-glow] bg-[--color-green-soft]'
                  : 'text-[--color-cream-mute] hover:text-[--color-cream-dim] glass-pill'
              }`}
            >
              {c.etiqueta}
            </button>
          ))}
        </div>

        <label className="block text-[12px] text-[--color-cream-mute] mb-1.5">
          ¿Qué debería haber hecho el bot?
        </label>
        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={3}
          placeholder="Ej: cuando pregunten cómo llegar desde Liberia, ofrecé primero el traslado del lodge con el precio."
          className="w-full glass-inset px-3 py-2.5 text-[12.5px] text-[--color-cream] leading-relaxed outline-none resize-y focus:ring-1 focus:ring-[--color-green-ring]"
        />

        {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}

        <button
          onClick={guardar}
          disabled={guardando}
          className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[12.5px] font-medium disabled:opacity-60"
          style={{
            background: 'linear-gradient(180deg, var(--color-green-glow), var(--color-green))',
            color: '#0a1c11',
          }}
        >
          {guardando && <Loader2 size={14} className="animate-spin" />}
          Guardar revisión
        </button>
      </div>

      {/* Resultado de la generación de la regla */}
      {reglaGenerada && (
        <div className="glass-inset p-4 mt-4">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-[--color-cream-mute] mb-2">
            {reglaGenerada.kind === 'conflicto' ? 'Esta regla ya existe' : 'Regla propuesta'}
          </h3>
          {reglaGenerada.kind === 'conflicto' ? (
            <p className="text-[12.5px] text-[--color-cream-dim] leading-relaxed">
              El prompt ya cubre esto: el bot no siguió una regla que ya tenía. Revisala en la
              pestaña <strong>Reglas por revisar</strong> para decidir qué hacer.
            </p>
          ) : (
            <>
              <p className="text-[12.5px] text-[--color-cream-dim] leading-relaxed">
                <strong className="text-[--color-cream]">Cuándo:</strong> {reglaGenerada.trigger_text}
              </p>
              <p className="text-[12.5px] text-[--color-cream-dim] leading-relaxed mt-1">
                <strong className="text-[--color-cream]">Qué debe hacer:</strong>{' '}
                {reglaGenerada.rule_text}
              </p>
              <p className="text-[12px] text-[--color-cream-faint] mt-2">
                Queda pendiente de tu aprobación en <strong>Reglas por revisar</strong>. El bot
                todavía no cambió.
              </p>
            </>
          )}
          <button
            onClick={onGuardado}
            className="glass-pill mt-3 inline-flex items-center px-4 py-2 rounded-full text-[12.5px] text-[--color-cream-dim] hover:text-[--color-cream] transition"
          >
            Volver a la bandeja
          </button>
        </div>
      )}

      {errorRegla && (
        <div className="glass-inset p-4 mt-4">
          <p className="text-[12.5px] text-[--color-cream-dim] leading-relaxed">{errorRegla}</p>
          <button
            onClick={reintentarRegla}
            disabled={reintentando}
            className="glass-pill mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] text-[--color-cream-dim] hover:text-[--color-cream] transition disabled:opacity-60"
          >
            {reintentando ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
            Reintentar generar regla
          </button>
        </div>
      )}
    </section>
  );
}

function BotonMarca({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-[26px] h-[26px] grid place-items-center rounded-full transition ${
        activo
          ? 'text-[--color-green-glow] bg-[--color-green-soft]'
          : 'text-[--color-cream-faint] hover:text-[--color-cream-dim]'
      }`}
    >
      {children}
    </button>
  );
}
