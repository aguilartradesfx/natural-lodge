import { Marca } from './GuideUI';

/**
 * Reproducciones de las pantallas del panel, con las mismas clases y colores
 * que la aplicación real. Cada anotación envuelve al elemento que señala.
 */

const pill =
  'glass-pill inline-flex items-center px-[15px] py-[8px] rounded-full text-[12px] font-medium text-[--color-cream-dim] whitespace-nowrap';

/* ── Pantalla principal ───────────────────────────────────────── */
export function PantallaPrincipal() {
  return (
    <div className="min-w-[600px]">
      {/* Cabecera */}
      <div className="glass flex items-center justify-between gap-4 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div
            className="w-[40px] h-[40px] rounded-[13px] grid place-items-center text-[14px] text-[--color-green-glow]"
            style={{
              background: 'linear-gradient(135deg, rgba(127,184,138,.18), rgba(20,32,26,.6))',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
            }}
          >
            NL
          </div>
          <div className="leading-[1.2]">
            <div className="text-[15px] font-medium text-[--color-cream]">Natural Lodge</div>
            <div className="text-[9.5px] uppercase tracking-[0.16em] text-[--color-cream-mute] mt-[2px]">
              Panel del chatbot
            </div>
          </div>
        </div>

        <Marca n={1} lado="abajo" radio={999}>
          <div className="flex items-center gap-2">
            <span className={pill}>Manual</span>
            <span className={pill}>Revisión</span>
            <span className={pill}>Asistente IA</span>
            <span className={pill}>Probar chat</span>
          </div>
        </Marca>
      </div>

      {/* Interruptor */}
      <div className="mt-10">
        <Marca n={2} lado="izquierda">
          <div className="glass flex items-center justify-between gap-4 px-[26px] py-[22px]">
            <div className="flex items-center gap-[18px]">
              <div
                className="w-[40px] h-[40px] rounded-full grid place-items-center"
                style={{ background: 'var(--color-green-soft)' }}
              >
                <span
                  className="w-[11px] h-[11px] rounded-full"
                  style={{
                    background: 'var(--color-green-glow)',
                    boxShadow: '0 0 18px var(--color-green-ring)',
                  }}
                />
              </div>
              <div>
                <div className="text-[15px] font-medium text-[--color-cream]">Bot activo</div>
                <div className="text-[11.5px] text-[--color-cream-mute] mt-[2px]">
                  Actualizado 01 ago, 02:43 p. m.
                </div>
              </div>
            </div>
            <div
              className="relative w-[52px] h-[30px] rounded-full"
              style={{
                background: 'var(--color-green-ring)',
                boxShadow: '0 0 0 1px rgba(127,184,138,0.5)',
              }}
            >
              <span
                className="absolute top-[3px] left-[25px] w-[24px] h-[24px] rounded-full"
                style={{ background: 'var(--color-green-glow)' }}
              />
            </div>
          </div>
        </Marca>
      </div>

      {/* Agentes */}
      <div className="mt-8 glass-lifted rounded-[16px] overflow-hidden">
        {/* A la derecha, no arriba: arriba chocaría con la insignia 2. */}
        <Marca n={3} lado="derecha" radio={0}>
          <div
            className="grid grid-cols-3 gap-1.5 p-2"
            style={{ background: 'rgba(0,0,0,0.18)' }}
          >
            <Tab activo sigla="SO" nombre="Soporte" rol="Huéspedes" />
            <Tab sigla="BI" nombre="Big Day" rol="Evento · activo" evento />
            <Tab sigla="VE" nombre="Ventas — Lorena" rol="Reservas" />
          </div>
        </Marca>

        <div className="px-7 py-7">
          <Marca n={4} lado="izquierda">
            <div className="glass-inset px-6 py-5 text-[12.5px] leading-[1.8] text-[--color-cream-dim] font-mono whitespace-pre-wrap">
              {`Eres el asistente de soporte de Natural Lodge Caño Negro.
Atiendes huéspedes con reservas activas.

CÓMO HABLAS
- Tutea siempre. Nunca uses "usted" ni "vos".
- Mensajes cortos. 1-3 oraciones cuando se puede.`}
            </div>
          </Marca>

          <div className="mt-9 flex items-center justify-end gap-2">
            <Marca n={5} lado="izquierda" radio={14}>
              <span
                className="inline-flex px-[26px] py-3 rounded-[14px] text-[13.5px] font-semibold"
                style={{
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
                  color: 'var(--color-cream-mute)',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.04)',
                }}
              >
                Guardar cambios
              </span>
            </Marca>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tab({
  activo,
  sigla,
  nombre,
  rol,
  evento,
}: {
  activo?: boolean;
  sigla: string;
  nombre: string;
  rol: string;
  evento?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 px-[18px] py-3.5 rounded-[14px]"
      style={
        activo
          ? {
              background: 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
            }
          : undefined
      }
    >
      <span
        className="w-[36px] h-[36px] grid place-items-center rounded-[11px] text-[11px] font-semibold tracking-wider shrink-0"
        style={
          activo
            ? {
                background: 'linear-gradient(135deg, rgba(127,184,138,.22), rgba(127,184,138,.06))',
                color: 'var(--color-green-glow)',
              }
            : { background: 'rgba(255,255,255,0.05)', color: 'var(--color-cream-mute)' }
        }
      >
        {sigla}
      </span>
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-[--color-cream] truncate">{nombre}</div>
        <div
          className="text-[10px] uppercase tracking-[0.14em] mt-px truncate"
          style={{ color: evento ? 'var(--color-green-glow)' : 'var(--color-cream-mute)' }}
        >
          {rol}
        </div>
      </div>
    </div>
  );
}

/* ── Configuración del evento ─────────────────────────────────── */
export function PantallaEvento() {
  return (
    <div className="min-w-[560px]">
      <Marca n={1} lado="arriba" radio={13}>
        <div className="glass-inset px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-medium text-[--color-cream]">
              Configuración del evento
            </div>
            <div className="text-[12px] text-[--color-cream-mute] mt-px">
              El bot responde sobre este evento cuando lo mencionan.
            </div>
          </div>
          <Marca n={2} lado="izquierda" radio={999}>
            <div
              className="relative w-[52px] h-[30px] rounded-full shrink-0"
              style={{
                background: 'var(--color-green-ring)',
                boxShadow: '0 0 0 1px rgba(127,184,138,0.5)',
              }}
            >
              <span
                className="absolute top-[3px] left-[25px] w-[24px] h-[24px] rounded-full"
                style={{ background: 'var(--color-green-glow)' }}
              />
            </div>
          </Marca>
        </div>
      </Marca>

      <div className="grid grid-cols-2 gap-6 mt-10">
        <Marca n={3} lado="abajo">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[--color-cream-mute] mb-2">
              Nombre del evento
            </div>
            <div className="glass-inset px-4 py-[11px] text-[13.5px] text-[--color-cream]">
              Big Day Caño Negro
            </div>
          </div>
        </Marca>

        <Marca n={4} lado="abajo">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[--color-cream-mute] mb-2">
              Palabras que activan el evento
            </div>
            <div className="glass-inset px-4 py-[11px] text-[13.5px] text-[--color-cream] truncate">
              big day, avistamiento, ebird, pajarero
            </div>
          </div>
        </Marca>
      </div>
    </div>
  );
}

/* ── Asistente de prompts ─────────────────────────────────────── */
export function PantallaAsistente() {
  return (
    <div className="min-w-[560px]">
      <div className="text-[15px] font-medium text-[--color-cream]">Asistente de prompts</div>
      <div className="text-[12.5px] text-[--color-cream-mute] mt-1 mb-7">
        Describí lo que querés agregar, Claude lo redacta y lo inyecta en los agentes que elijas.
      </div>

      <Marca n={1} lado="izquierda" radio={13}>
        <div className="glass-inset px-5 py-4 text-[13px] leading-[1.7] text-[--color-cream]">
          Cuando pregunten cómo llegar desde el aeropuerto de Liberia, ofrecé primero el
          traslado privado del lodge: 180 dólares por trayecto.
        </div>
      </Marca>

      <div className="mt-9">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[--color-cream-mute] mb-3">
          Inyectar en
        </div>
        <Marca n={2} lado="derecha" radio={999}>
          <div className="inline-flex gap-2">
            <span className={pill}>Soporte</span>
            <span className={pill}>Big Day</span>
            <span
              className="glass-pill inline-flex items-center px-[15px] py-[8px] rounded-full text-[12px] font-medium text-[--color-green-glow]"
              style={{ boxShadow: '0 0 0 1px var(--color-green-ring)' }}
            >
              Ventas
            </span>
          </div>
        </Marca>
      </div>

      <div className="mt-9">
        <Marca n={3} lado="derecha" radio={999}>
          <span
            className="inline-flex px-[24px] py-[11px] rounded-full text-[13px] font-semibold"
            style={{
              background: 'linear-gradient(180deg, var(--color-green-glow), var(--color-green))',
              color: '#0a1c11',
            }}
          >
            Redactar fragmento
          </span>
        </Marca>
      </div>
    </div>
  );
}

/* ── Bandeja de revisión ──────────────────────────────────────── */
export function PantallaRevision() {
  return (
    <div className="min-w-[600px]">
      <Marca n={1} lado="derecha" radio={999}>
        <div className="inline-flex gap-2">
          <span
            className="glass-pill inline-flex items-center px-[15px] py-[8px] rounded-full text-[12px] font-medium text-[--color-green-glow]"
            style={{ boxShadow: '0 0 0 1px var(--color-green-ring)' }}
          >
            Bandeja
          </span>
          <span className={pill}>
            Reglas por revisar&nbsp;<b className="text-[--color-green-glow]">2</b>
          </span>
          <span className={pill}>
            Aplicar al prompt&nbsp;<b className="text-[--color-green-glow]">1</b>
          </span>
        </div>
      </Marca>

      <div className="flex items-center justify-between gap-4 mt-9">
        <div className="inline-flex gap-2">
          <span className={pill}>Por revisar</span>
          <span className={pill}>Revisadas</span>
          <span className={pill}>Todas</span>
        </div>
        <Marca n={2} lado="izquierda" radio={999}>
          <span className={pill}>Actualizar bandeja</span>
        </Marca>
      </div>

      <div className="mt-9">
        <Marca n={3} lado="izquierda" radio={13}>
          <div className="glass-inset px-4 py-3.5">
            <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
              <b className="text-[13px] text-[--color-cream]">+50688736424</b>
              <span className="text-[10px] uppercase tracking-[0.1em] text-[--color-cream-mute]">
                ventas
              </span>
              <span className="text-[10.5px] text-[--color-cream-faint]">01/08/26, 14:37</span>
              <span className="ml-auto text-[10.5px] text-[--color-cream-faint]">
                prioridad 75
              </span>
            </div>
            <div className="text-[12.5px] leading-[1.55] text-[--color-cream-dim]">
              El huésped preguntó cómo llegar desde el aeropuerto de Liberia. El bot solo
              sugirió transporte público y no resolvió la consulta.
            </div>
            <div className="mt-3">
              <Marca n={4} lado="derecha" radio={999} inline>
                <span className="inline-flex gap-1.5">
                  <span
                    className="px-2.5 py-[3px] rounded-full text-[10px]"
                    style={{ color: '#FCA5A5', background: 'rgba(239,68,68,.12)' }}
                  >
                    Escaló a humano
                  </span>
                  <span
                    className="px-2.5 py-[3px] rounded-full text-[10px] text-[--color-cream-mute]"
                    style={{ background: 'rgba(255,255,255,.055)' }}
                  >
                    Derivado a ventas
                  </span>
                </span>
              </Marca>
            </div>
          </div>
        </Marca>
      </div>
    </div>
  );
}
