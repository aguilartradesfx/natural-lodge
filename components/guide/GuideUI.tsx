import type { ReactNode } from 'react';

/**
 * Piezas del manual. Sin estado ni hooks: son componentes de servidor.
 *
 * La marca roja NO se posiciona con coordenadas. Envuelve al elemento y dibuja
 * el círculo sobre sus propios bordes, así queda siempre alineada aunque el
 * texto crezca o la pantalla cambie de tamaño — que es justo lo que fallaba
 * cuando las anotaciones iban por porcentaje.
 */

const ROJO = '#E5484D';

type Lado = 'derecha' | 'izquierda' | 'arriba' | 'abajo';

const LADO: Record<Lado, string> = {
  derecha: 'top-1/2 -translate-y-1/2 left-full ml-[11px]',
  izquierda: 'top-1/2 -translate-y-1/2 right-full mr-[11px]',
  arriba: 'left-1/2 -translate-x-1/2 bottom-full mb-[11px]',
  abajo: 'left-1/2 -translate-x-1/2 top-full mt-[11px]',
};

export function Marca({
  n,
  lado = 'derecha',
  inline = false,
  radio = 16,
  children,
}: {
  n: number;
  lado?: Lado;
  inline?: boolean;
  radio?: number;
  children: ReactNode;
}) {
  return (
    <div className={`relative ${inline ? 'inline-block align-middle' : ''}`}>
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-[7px]"
        style={{
          border: `2px solid ${ROJO}`,
          borderRadius: radio + 7,
          boxShadow: `0 0 0 3px ${ROJO}22`,
        }}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute ${LADO[lado]} w-[25px] h-[25px] rounded-full grid place-items-center text-[13px] font-bold text-white`}
        style={{ background: ROJO, boxShadow: '0 2px 8px rgba(0,0,0,.45)' }}
      >
        {n}
      </span>
    </div>
  );
}

/** Marco tipo ventana del navegador para envolver una pantalla recreada. */
export function Pantalla({ url, children }: { url: string; children: ReactNode }) {
  return (
    <figure className="my-8 rounded-[16px] overflow-hidden glass-lifted">
      <div
        className="flex items-center gap-[7px] px-4 py-[11px]"
        style={{
          background: 'rgba(255,255,255,0.03)',
          boxShadow: '0 -1px 0 rgba(255,255,255,0.05) inset',
        }}
      >
        <span className="w-[10px] h-[10px] rounded-full bg-white/10" />
        <span className="w-[10px] h-[10px] rounded-full bg-white/10" />
        <span className="w-[10px] h-[10px] rounded-full bg-white/10" />
        <span className="ml-2.5 text-[11px] text-[--color-cream-faint] font-mono">{url}</span>
      </div>
      {/*
        Padding amplio a propósito: la insignia roja se dibuja 36px por fuera
        del elemento que marca. Con menos aire quedaría cortada por el borde
        del marco — que es justo el defecto que tenía la versión anterior.
      */}
      <div
        className="overflow-x-auto px-12 sm:px-16 py-12"
        style={{ background: 'var(--color-bg-base)' }}
      >
        {children}
      </div>
    </figure>
  );
}

/** Lista numerada que explica cada marca roja de la pantalla de arriba. */
export function Leyenda({ items }: { items: { t: string; d: ReactNode }[] }) {
  return (
    <ol className="list-none p-0 m-0 grid gap-4">
      {items.map((it, i) => (
        <li key={i} className="grid grid-cols-[25px_1fr] gap-3.5 items-start">
          <span
            className="w-[25px] h-[25px] rounded-full grid place-items-center text-[13px] font-bold text-white mt-[2px]"
            style={{ background: ROJO }}
          >
            {i + 1}
          </span>
          <div>
            <b className="text-[14px] font-semibold text-[--color-cream]">{it.t}</b>
            <p className="mt-[3px] mb-0 text-[13.5px] leading-[1.6] text-[--color-cream-dim]">
              {it.d}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Nota({
  tono = 'verde',
  titulo,
  children,
}: {
  tono?: 'verde' | 'ambar' | 'rojo';
  titulo: string;
  children: ReactNode;
}) {
  const color =
    tono === 'ambar' ? '#E3B341' : tono === 'rojo' ? ROJO : 'var(--color-green-glow)';
  const fondo =
    tono === 'ambar'
      ? 'rgba(227,179,65,0.07)'
      : tono === 'rojo'
        ? 'rgba(229,72,77,0.07)'
        : 'rgba(127,184,138,0.06)';
  return (
    <aside
      className="my-6 px-[22px] py-[18px] rounded-[13px] relative overflow-hidden"
      style={{ background: fondo, boxShadow: `0 0 0 1px ${color}25` }}
    >
      <span className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: color }} />
      <div
        className="text-[10.5px] font-bold uppercase tracking-[0.15em] mb-2"
        style={{ color }}
      >
        {titulo}
      </div>
      <div className="text-[13.5px] leading-[1.65] text-[--color-cream-dim] [&>p]:m-0 [&>p+p]:mt-2.5">
        {children}
      </div>
    </aside>
  );
}

/** Un paso del recorrido de decisiones del bot. */
export function Paso({ q, titulo, children }: { q: string; titulo: string; children: ReactNode }) {
  return (
    <div className="glass-inset grid grid-cols-[auto_1fr] gap-4 items-start px-5 py-4">
      <span
        className="text-[11px] font-bold uppercase tracking-[0.1em] pt-[3px] whitespace-nowrap"
        style={{ color: ROJO }}
      >
        {q}
      </span>
      <div>
        <b className="text-[14px] font-semibold text-[--color-cream]">{titulo}</b>
        <p className="mt-[3px] mb-0 text-[13.5px] leading-[1.6] text-[--color-cream-dim]">
          {children}
        </p>
      </div>
    </div>
  );
}

export function Seccion({
  id,
  eyebrow,
  titulo,
  children,
}: {
  id: string;
  eyebrow: string;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 mb-20">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[--color-cream-faint] m-0">
        {eyebrow}
      </p>
      <h2 className="mt-2 mb-4 text-[26px] sm:text-[32px] font-medium tracking-[-0.025em] leading-[1.15] text-[--color-cream] text-balance">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** Párrafo del manual, con ancho de lectura cómodo. */
export function P({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[68ch] text-[15px] leading-[1.7] text-[--color-cream-dim] my-4">
      {children}
    </p>
  );
}
