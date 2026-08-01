'use client';
import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { SIGNAL_LABELS, type Signal } from '@/lib/conversation-episodes';
import type { ReviewRow } from '@/lib/reviews';

const ESTADOS = [
  { valor: 'pendiente', etiqueta: 'Por revisar' },
  { valor: 'revisada', etiqueta: 'Revisadas' },
  { valor: '', etiqueta: 'Todas' },
] as const;

/** Señales que pintan el chip en rojo; el resto va en tono neutro. */
const SEÑALES_GRAVES: Signal[] = ['escalamiento', 'error_bot'];

export function ReviewInbox({
  reviews,
  cargando,
  refrescando,
  onAbrir,
  onActualizar,
}: {
  reviews: ReviewRow[];
  cargando: boolean;
  refrescando: boolean;
  onAbrir: (id: number) => void;
  onActualizar: () => void;
}) {
  const [estado, setEstado] = useState<string>('pendiente');
  const [agente, setAgente] = useState<string>('');

  const agentes = useMemo(() => [...new Set(reviews.map((r) => r.agente))].sort(), [reviews]);

  const visibles = useMemo(
    () =>
      reviews.filter((r) => (!estado || r.status === estado) && (!agente || r.agente === agente)),
    [reviews, estado, agente],
  );

  return (
    <section className="glass fade-up fade-up-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {ESTADOS.map((e) => (
            <FiltroPill
              key={e.valor}
              activo={estado === e.valor}
              onClick={() => setEstado(e.valor)}
            >
              {e.etiqueta}
            </FiltroPill>
          ))}
          <span className="w-px h-4 bg-[--color-glass-border] mx-1" />
          <FiltroPill activo={agente === ''} onClick={() => setAgente('')}>
            Todos los agentes
          </FiltroPill>
          {agentes.map((a) => (
            <FiltroPill key={a} activo={agente === a} onClick={() => setAgente(a)}>
              {a}
            </FiltroPill>
          ))}
        </div>

        <button
          onClick={onActualizar}
          disabled={refrescando}
          className="glass-pill inline-flex items-center gap-2 px-4 py-[9px] rounded-full text-[--color-cream-dim] text-[12.5px] font-medium hover:text-[--color-cream] transition disabled:opacity-60"
        >
          {refrescando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Actualizar bandeja
        </button>
      </div>

      {cargando && (
        <p className="text-[12.5px] text-[--color-cream-mute] px-1 py-2">Abriendo conversación…</p>
      )}

      {visibles.length === 0 ? (
        <p className="text-[13px] text-[--color-cream-mute] px-1 py-6 text-center">
          No hay conversaciones con esos filtros. Probá con &ldquo;Todas&rdquo; o apretá
          &ldquo;Actualizar bandeja&rdquo;.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibles.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onAbrir(r.id)}
                className="glass-inset w-full text-left px-4 py-3 hover:-translate-y-[1px] transition-transform"
              >
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="text-[13px] text-[--color-cream] font-medium">{r.phone}</span>
                  <span className="text-[11px] text-[--color-cream-mute] uppercase tracking-[0.1em]">
                    {r.agente}
                  </span>
                  <span className="text-[11px] text-[--color-cream-faint]">
                    {new Date(r.window_end).toLocaleString('es-CR', {
                      timeZone: 'America/Costa_Rica',
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                  {r.status === 'revisada' && (
                    <span className="text-[11px] text-[--color-green-glow]">revisada</span>
                  )}
                  <span className="ml-auto text-[11px] text-[--color-cream-faint]">
                    prioridad {r.priority}
                  </span>
                </div>

                <p className="text-[12.5px] text-[--color-cream-dim] leading-relaxed line-clamp-2">
                  {r.summary || 'Sin resumen'}
                </p>

                {r.signals.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {r.signals.map((s) => (
                      <span
                        key={s}
                        className="px-2 py-px rounded-full text-[10.5px]"
                        style={
                          SEÑALES_GRAVES.includes(s)
                            ? { color: '#fca5a5', background: 'rgba(239,68,68,0.10)' }
                            : {
                                color: 'var(--color-cream-mute)',
                                background: 'var(--color-glass-2)',
                              }
                        }
                      >
                        {SIGNAL_LABELS[s] ?? s}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FiltroPill({
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
      className={`px-3 py-1.5 rounded-full text-[12px] transition ${
        activo
          ? 'text-[--color-green-glow] bg-[--color-green-soft]'
          : 'text-[--color-cream-mute] hover:text-[--color-cream-dim]'
      }`}
    >
      {children}
    </button>
  );
}
