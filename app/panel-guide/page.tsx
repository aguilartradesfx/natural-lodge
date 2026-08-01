import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase/admin';
import { Leyenda, Nota, P, Pantalla, Paso, Seccion } from '@/components/guide/GuideUI';
import {
  PantallaAsistente,
  PantallaEvento,
  PantallaPrincipal,
  PantallaRevision,
} from '@/components/guide/Screens';

export const dynamic = 'force-dynamic';

const INDICE = [
  ['panel', 'La pantalla principal', 'Prender, apagar y editar'],
  ['agentes', 'Los tres agentes', 'Quién atiende qué'],
  ['evento', 'El agente de evento', 'Encender, renombrar y editar'],
  ['herramientas', 'Las herramientas', 'Asistente, prueba, importador'],
  ['revision', 'Revisión de conversaciones', 'Pendiente de activar'],
  ['decide', 'Cómo decide el bot solo', 'El orden exacto'],
  ['funciones', 'Tabla de funciones', 'Qué es y qué condiciones tiene'],
  ['falla', 'Cuando algo no funciona', 'Qué mirar primero'],
] as const;

type Fila = { nombre: string; donde: string; que: string; cond: string[] };

const FUNCIONES: Fila[] = [
  {
    nombre: 'Interruptor del bot',
    donde: 'Panel',
    que: 'Enciende o apaga las respuestas automáticas para todos los huéspedes a la vez.',
    cond: [
      'Si está apagado: el bot no procesa ningún mensaje. Nada más se evalúa.',
      'Si falla la lectura del estado: asume que está encendido, para no dejar huéspedes sin atención por un error técnico.',
      'El cambio aplica al siguiente mensaje que entre.',
    ],
  },
  {
    nombre: 'Editor de agentes',
    donde: 'Panel',
    que: 'El texto de instrucciones que define la personalidad y el conocimiento de cada agente.',
    cond: [
      'Si no modificaste nada: el botón Guardar está apagado y no se puede apretar.',
      'Si guardaste: aplica desde el siguiente mensaje. No hay que reiniciar nada.',
      '«Descartar» devuelve todo a como estaba guardado, sin confirmación.',
    ],
  },
  {
    nombre: 'Agente de evento',
    donde: 'Panel',
    que: 'Un agente dedicado a un evento puntual, con su propio nombre, información y palabras que lo activan.',
    cond: [
      'Si está apagado: el bot ignora el evento y atiende como Ventas, aunque lo mencionen.',
      'Si no tiene palabras clave: nunca se activa, aunque esté encendido. El panel te avisa.',
      'Si el huésped tiene reserva activa: contesta Soporte, no el evento.',
      'Renombrar el evento no cambia su historial ni su memoria: el identificador interno se mantiene.',
    ],
  },
  {
    nombre: 'Asistente IA',
    donde: 'Panel',
    que: 'Convierte una idea escrita en español coloquial en una instrucción bien redactada y la integra al agente que elijas.',
    cond: [
      'Si elegís varios agentes: redacta una vez y la integra en cada uno por separado.',
      'Antes de guardar: siempre muestra el comparativo en verde y rojo. Nada se aplica sin confirmar.',
      'Si la idea trae precios u horarios: los conserva textuales, sin reescribirlos.',
    ],
  },
  {
    nombre: 'Probar chat',
    donde: 'Panel',
    que: 'Una conversación de prueba con el agente, usando sus instrucciones actuales.',
    cond: [
      'Nunca envía mensajes reales por WhatsApp ni queda como conversación del huésped.',
      'Usa la misma configuración de evento que el bot real: lo que probás es lo que pasa.',
      'Si simulás un teléfono con reserva: responde como si fuera ese huésped.',
    ],
  },
  {
    nombre: 'Importar contactos',
    donde: 'Panel',
    que: 'Carga masiva de prospectos desde Excel o CSV hacia GoHighLevel, con etiquetas, nota y oportunidad.',
    cond: [
      'Primero previsualiza: muestra el resumen y la tabla sin crear nada.',
      'Si el contacto ya existe (correo, teléfono o coincidencia de datos): lo actualiza en vez de duplicarlo.',
      'Si a una fila le falta correo y teléfono: la omite y la reporta al final.',
    ],
  },
  {
    nombre: 'Ruteo de agentes',
    donde: 'Automático',
    que: 'La decisión de cuál agente contesta cada mensaje.',
    cond: [
      'Si pide hablar con una persona: escala y no contesta ningún agente.',
      'Si tiene reserva activa: Soporte — tiene prioridad incluso sobre el evento.',
      'Si menciona el evento y no tiene reserva: el agente de evento.',
      'En cualquier otro caso: Ventas.',
    ],
  },
  {
    nombre: 'Silenciar un contacto',
    donde: 'GoHighLevel',
    que: 'La etiqueta «bot desactivado» en la ficha de un contacto apaga el bot solo para esa persona.',
    cond: [
      'Si la tiene: el bot ignora todos sus mensajes; contesta un humano.',
      'Se pone y se quita desde GoHighLevel, no desde el panel.',
      'Útil para números internos: recepción, gerencia, proveedores.',
    ],
  },
  {
    nombre: 'Límite de mensajes',
    donde: 'Automático',
    que: 'Protección contra un mismo número que manda demasiados mensajes seguidos.',
    cond: [
      'Si manda 10 o más en 60 segundos: responde pidiendo que espere y no procesa.',
      'Se cuenta por número de teléfono, no por conversación.',
    ],
  },
  {
    nombre: 'Imágenes y audios',
    donde: 'Automático',
    que: 'Qué hace el bot cuando le mandan algo que no es texto.',
    cond: [
      'Si es imagen: la describe y responde tomándola en cuenta.',
      'Si es audio: hoy responde que no puede procesarlo. Falta configurar la transcripción.',
      'Si no puede leer el mensaje: pide amablemente que lo reescriba.',
    ],
  },
  {
    nombre: 'Pausa antes de responder',
    donde: 'Automático',
    que: 'El bot espera 30 segundos antes de mandar su respuesta.',
    cond: [
      'Si el huésped manda varios mensajes seguidos: responde una sola vez a todo junto.',
      'El tiempo es ajustable si les parece mucho.',
    ],
  },
  {
    nombre: 'Memoria de la conversación',
    donde: 'Automático',
    que: 'El bot recuerda lo ya hablado para no repetir preguntas.',
    cond: [
      'Soporte y Ventas recuerdan los últimos 30 mensajes. El agente de evento, 20.',
      'Cada agente tiene memoria separada: lo que le contaste a Ventas no lo sabe Soporte.',
    ],
  },
  {
    nombre: 'Etiquetas de check-in',
    donde: 'Automático',
    que: 'Cada día marca las reservas según cuánto falta para la llegada y dispara las automatizaciones del equipo.',
    cond: [
      'Faltan 3 días, mañana, hoy, y check-out realizado: una etiqueta por cada momento.',
      'Solo actúa sobre reservas confirmadas.',
      'Si la etiqueta ya está puesta, no la repite.',
    ],
  },
  {
    nombre: 'Reservas desde Orbe',
    donde: 'Automático',
    que: 'Cuando entra o cambia una reserva en Orbe, actualiza el contacto y la cita en GoHighLevel.',
    cond: [
      'Reserva nueva confirmada: crea la cita y etiqueta «Confirmada ✅».',
      'Reserva modificada: reemplaza la cita anterior por la nueva.',
      'Reserva cancelada: borra la cita y etiqueta «Cancelado ❌».',
      'Si el mismo evento llega dos veces: lo ignora, no duplica.',
    ],
  },
  {
    nombre: 'Bandeja de revisión',
    donde: 'Pendiente',
    que: 'Resume las conversaciones terminadas y las ordena por urgencia para que alguien las lea.',
    cond: [
      'Una conversación se considera terminada tras 6 horas sin mensajes.',
      'Sube en la lista si escaló a un humano, si el bot dio error o si se derivó a ventas.',
      'Si se ejecuta dos veces, no duplica conversaciones.',
    ],
  },
  {
    nombre: 'Reglas aprendidas',
    donde: 'Pendiente',
    que: 'Convierte tu comentario sobre una conversación en una instrucción nueva para el agente.',
    cond: [
      'Si calificás sin comentar: solo cuenta para las estadísticas, no genera regla.',
      'Si la instrucción ya existía: te lo avisa en vez de duplicarla — el problema fue que el bot no la siguió.',
      'Nada llega al bot hasta que apruebes la regla y después el cambio de texto.',
      'Si la IA falla al redactar, tu comentario queda guardado y se puede reintentar.',
    ],
  },
];

const TONO_DONDE: Record<string, string> = {
  Panel: 'var(--color-green-glow)',
  Automático: 'var(--color-cream-dim)',
  GoHighLevel: 'var(--color-cream-dim)',
  Pendiente: '#E3B341',
};

export default async function PanelGuidePage() {
  // El nombre del evento sale de la base: si mañana lo renombran, el manual
  // se actualiza solo en lugar de quedar mintiendo.
  let nombreEvento = 'Big Day';
  let eventoActivo = true;
  try {
    const { data } = await createAdminClient()
      .from('nlcn_agent_prompts')
      .select('display_name, is_enabled')
      .eq('is_event', true)
      .maybeSingle();
    if (data) {
      nombreEvento = data.display_name || nombreEvento;
      eventoActivo = data.is_enabled !== false;
    }
  } catch {
    /* si falla, el manual usa el nombre por defecto */
  }

  return (
    <div className="relative z-[2] max-w-[1080px] mx-auto px-5 sm:px-9 pt-7 pb-24">
      {/* Cabecera */}
      <header className="glass fade-up flex items-center justify-between gap-4 px-5 py-3.5 relative overflow-hidden">
        <div className="absolute top-0 left-[20%] right-[20%] h-px green-line opacity-50" />
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="glass-pill inline-flex items-center gap-2 px-3.5 py-[7px] rounded-full text-[--color-cream-dim] text-[12.5px] hover:text-[--color-cream] transition"
          >
            <ArrowLeft size={14} />
            Panel
          </Link>
          <div className="leading-[1.2]">
            <div className="text-[16px] font-medium text-[--color-cream] tracking-tight">
              Manual del panel
            </div>
            <div className="text-[10.5px] font-medium text-[--color-cream-mute] uppercase tracking-[0.16em] mt-[2px]">
              Natural Lodge Caño Negro
            </div>
          </div>
        </div>
      </header>

      {/* Portada */}
      <div className="mt-14 mb-10 px-1 fade-up fade-up-2">
        <h1 className="text-[38px] sm:text-[46px] font-light leading-[1.05] tracking-[-0.03em] text-[--color-cream] text-balance">
          Cómo se{' '}
          <em
            className="italic font-medium"
            style={{
              background: 'linear-gradient(135deg, var(--color-green-glow), var(--color-green))',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            maneja el bot
          </em>
        </h1>
        <p className="mt-4 text-[15.5px] leading-[1.65] text-[--color-cream-mute] max-w-[62ch]">
          Encender, apagar, corregir y supervisar al asistente que atiende a los huéspedes
          por WhatsApp, Instagram y Facebook. No hace falta saber nada técnico.
        </p>
      </div>

      {/* Índice */}
      <nav className="glass-lifted rounded-[16px] overflow-hidden fade-up fade-up-3 mb-20">
        {INDICE.map(([id, t, s], i) => (
          <Link
            key={id}
            href={`#${id}`}
            className="flex items-baseline justify-between gap-5 px-6 py-[15px] hover:bg-white/[0.03] transition-colors"
            style={{ boxShadow: i > 0 ? '0 1px 0 rgba(255,255,255,0.04) inset' : undefined }}
          >
            <span className="text-[14.5px] font-medium text-[--color-cream]">
              <span className="text-[--color-cream-faint] mr-2.5 tabular-nums">{i + 1}</span>
              {t}
            </span>
            <span className="text-[12.5px] text-[--color-cream-faint] text-right">{s}</span>
          </Link>
        ))}
      </nav>

      {/* ─── 1 ─── */}
      <Seccion id="panel" eyebrow="Capítulo uno" titulo="La pantalla principal">
        <P>
          Es lo primero que ves al entrar. Desde acá controlás si el bot contesta o no, y
          editás lo que sabe decir cada uno de sus agentes.
        </P>

        <Pantalla url="natural-lodge.vercel.app">
          <PantallaPrincipal />
        </Pantalla>

        <div className="max-w-[68ch]">
          <Leyenda
            items={[
              {
                t: 'Las herramientas',
                d: 'Manual, Revisión, Asistente IA y Probar chat. Cada una abre una pantalla o ventana aparte.',
              },
              {
                t: 'El interruptor del bot — lo más importante',
                d: 'El punto verde con pulso significa que el bot está contestando. Si lo apagás, deja de responderle a todos los huéspedes al instante. Usalo si el bot está diciendo algo incorrecto y necesitás tiempo para arreglarlo.',
              },
              {
                t: 'Los agentes',
                d: 'Hacé clic en uno para editarlo. El que está iluminado en verde es el que estás viendo.',
              },
              {
                t: 'Las instrucciones del agente',
                d: 'Este texto es literalmente lo que el bot lee antes de contestar. Escribí en español normal, como si le explicaras a un empleado nuevo.',
              },
              {
                t: 'Guardar cambios',
                d: 'Se enciende en verde solo cuando hay algo modificado. Lo guardado aplica desde el siguiente mensaje que reciba el bot.',
              },
            ]}
          />

          <Nota tono="ambar" titulo="Cuidado">
            <p>
              Apagar el interruptor no avisa a nadie. Los huéspedes que escriban mientras
              está apagado no reciben respuesta automática y quedan esperando a una persona.
              Si lo apagás, avisale a recepción.
            </p>
          </Nota>
        </div>
      </Seccion>

      {/* ─── 2 ─── */}
      <Seccion id="agentes" eyebrow="Capítulo dos" titulo="Los tres agentes: quién atiende qué">
        <div className="max-w-[68ch]">
          <P>
            El bot no es uno solo. Son tres personalidades distintas, y el sistema elige cuál
            contesta según quién escribe y qué dice. Cada una tiene su propio texto de
            instrucciones y su propia memoria.
          </P>

          <div className="grid gap-3 my-7">
            <AgenteCard
              sigla="SO"
              nombre="Soporte"
              cuando="Cuando quien escribe tiene una reserva activa registrada."
              hace="Responde sobre check-in, horarios y servicios del lodge. Recuerda los últimos 30 mensajes."
            />
            <AgenteCard
              sigla="BI"
              nombre={nombreEvento}
              cuando={`Cuando el mensaje menciona alguna de las palabras del evento${eventoActivo ? '' : ' — hoy está apagado'}.`}
              hace="Responde solo sobre ese evento. Recuerda los últimos 20 mensajes. Es configurable: ver el capítulo tres."
              evento
            />
            <AgenteCard
              sigla="VE"
              nombre="Ventas"
              cuando="Cuando quien escribe no tiene reserva."
              hace="Pregunta fechas y cantidad de personas, cotiza y empuja hacia la reserva. Es el que más conversaciones maneja."
            />
          </div>

          <Nota titulo="Un detalle que conviene saber">
            <p>
              Si un huésped <strong>ya alojado</strong> pregunta por el evento, lo atiende
              Soporte, no el agente del evento. La reserva activa siempre tiene prioridad.
            </p>
          </Nota>
        </div>
      </Seccion>

      {/* ─── 3 ─── */}
      <Seccion id="evento" eyebrow="Capítulo tres" titulo="El agente de evento">
        <P>
          Uno de los agentes está dedicado a un evento puntual — hoy{' '}
          <strong className="text-[--color-cream]">{nombreEvento}</strong>. Es un «cerebro»
          aparte, con la información de ese evento y nada más. A diferencia de los otros dos,
          este <strong className="text-[--color-cream]">se puede apagar y renombrar</strong>{' '}
          cuando el evento termina o cuando llega uno nuevo.
        </P>

        <Pantalla url="Configuración del evento">
          <PantallaEvento />
        </Pantalla>

        <div className="max-w-[68ch]">
          <Leyenda
            items={[
              {
                t: 'El bloque de configuración',
                d: 'Aparece solo en el agente de evento. Soporte y Ventas no lo tienen porque no se apagan ni se renombran.',
              },
              {
                t: 'Encender o apagar el evento',
                d: 'Apagado, el bot ignora el evento por completo: aunque un huésped lo mencione, lo atiende Ventas. Útil cuando el evento terminó y todavía no tenés el siguiente.',
              },
              {
                t: 'Nombre del evento',
                d: 'Es el nombre que ves en la pestaña. Cambiarlo no borra nada: el historial y la memoria se conservan.',
              },
              {
                t: 'Palabras que activan el evento',
                d: 'Separadas por coma. Si el huésped escribe alguna de ellas, contesta este agente. Son lo que hace que funcione: sin palabras, nunca se activa.',
              },
            ]}
          />

          <Nota tono="ambar" titulo="Si cambiás de evento, cambiá las tres cosas">
            <p>
              El nombre es solo la etiqueta. Para que un evento nuevo funcione de verdad hay
              que actualizar también <strong>las palabras clave</strong> (si nadie va a
              escribir «big day», esa palabra ya no sirve) y{' '}
              <strong>el texto de instrucciones</strong> con la información del evento nuevo.
            </p>
            <p>
              Después probalo en <strong>Probar chat</strong>: escribí una de las palabras
              nuevas y verificá que conteste el agente correcto.
            </p>
          </Nota>
        </div>
      </Seccion>

      {/* ─── 4 ─── */}
      <Seccion id="herramientas" eyebrow="Capítulo cuatro" titulo="Las herramientas">
        <P>Están en los botones de arriba. Ninguna cambia nada sin que vos confirmes.</P>

        <h3 className="mt-10 mb-1 text-[18px] font-medium text-[--color-cream]">
          Asistente IA — cambiar el bot sin pelear con el texto
        </h3>

        <Pantalla url="Asistente de prompts">
          <PantallaAsistente />
        </Pantalla>

        <div className="max-w-[68ch]">
          <Leyenda
            items={[
              {
                t: 'Escribí la idea como se te ocurra',
                d: 'En español normal. No hace falta redactarlo «bonito»: para eso está el asistente.',
              },
              {
                t: 'Elegí a qué agentes le aplica',
                d: 'Podés marcar uno o varios. Si la regla es sobre precios, probablemente sea Ventas; si es sobre el desayuno, Soporte.',
              },
              {
                t: 'Redactar y revisar',
                d: 'Te muestra el texto propuesto y, antes de guardar, un comparativo en verde y rojo con exactamente lo que se agrega y lo que se quita.',
              },
            ]}
          />

          <h3 className="mt-12 mb-1 text-[18px] font-medium text-[--color-cream]">
            Probar chat — conversar sin molestar a nadie
          </h3>
          <P>
            Abre una ventana de chat de mentira. Escribís como si fueras un huésped y el bot
            contesta con las instrucciones que tenga guardadas en ese momento.{' '}
            <strong className="text-[--color-cream]">No manda nada por WhatsApp</strong> y no
            queda como conversación real. Usalo siempre después de cambiar un prompt.
          </P>

          <h3 className="mt-12 mb-1 text-[18px] font-medium text-[--color-cream]">
            Importar contactos — subir prospectos en lote
          </h3>
          <P>
            Arrastrás un archivo de Excel o CSV y crea los contactos en GoHighLevel. El flujo
            es <strong className="text-[--color-cream]">subir → revisar → confirmar</strong>:
            primero te muestra un resumen en español y una tabla, sin tocar nada. Recién
            cuando apretás «Confirmar e importar» los crea, con sus etiquetas, una nota de
            venta y una oportunidad.
          </P>
        </div>
      </Seccion>

      {/* ─── 5 ─── */}
      <Seccion id="revision" eyebrow="Capítulo cinco" titulo="Revisión de conversaciones">
        <div className="max-w-[68ch]">
          <Nota tono="ambar" titulo="Todavía no está activo">
            <p>
              Esta sección está construida y probada, pero aún no se publicó. Cuando se
              active, este capítulo describe lo que vas a ver.
            </p>
          </Nota>

          <P>
            Sirve para que el bot mejore con el tiempo. Resume las conversaciones que ya
            terminaron, las pone en una lista, y convierte tus comentarios en reglas nuevas —
            pero{' '}
            <strong className="text-[--color-cream]">
              nunca cambia el bot sin que una persona apruebe dos veces
            </strong>
            .
          </P>
        </div>

        <Pantalla url="natural-lodge.vercel.app/panel-guide">
          <PantallaRevision />
        </Pantalla>

        <div className="max-w-[68ch]">
          <Leyenda
            items={[
              {
                t: 'Las tres pestañas del ciclo',
                d: 'Bandeja (conversaciones para leer), Reglas por revisar (lo que la IA propuso) y Aplicar al prompt (el cambio final). Los números en verde son cuántas cosas esperan.',
              },
              {
                t: 'Actualizar bandeja',
                d: 'Busca conversaciones nuevas que ya terminaron. Normalmente se llena sola una vez al día; este botón es para no esperar.',
              },
              {
                t: 'Una conversación',
                d: 'Con el resumen en una línea, para saber de qué se trata sin abrirla. Las más urgentes aparecen arriba.',
              },
              {
                t: 'Las señales en color',
                d: 'En rojo lo grave: el bot escaló a un humano o dio error. En gris lo que conviene mirar: derivó a ventas, conversación larga.',
              },
            ]}
          />

          <Nota titulo="Las dos aprobaciones">
            <p>
              Primero aprobás <strong>la regla</strong> («cuando pregunten X, hacé Y»), en
              lenguaje llano y editable palabra por palabra.
            </p>
            <p>
              Después aprobás <strong>el cambio al texto del agente</strong>, viendo en verde
              y rojo qué se agrega. Si algo sale mal, se restaura la versión anterior con un
              clic.
            </p>
          </Nota>
        </div>
      </Seccion>

      {/* ─── 6 ─── */}
      <Seccion id="decide" eyebrow="Capítulo seis" titulo="Cómo decide el bot, solo">
        <div className="max-w-[68ch]">
          <P>
            Cada vez que entra un mensaje, el sistema hace esta secuencia de preguntas.{' '}
            <strong className="text-[--color-cream]">
              La primera que da «sí» decide el resultado
            </strong>{' '}
            y las siguientes ni se evalúan.
          </P>
        </div>

        <div className="grid gap-2.5 mt-7 max-w-[78ch]">
          <Paso q="¿1?" titulo="¿El interruptor está apagado?">
            Si sí → no contesta nada y ahí termina.
          </Paso>
          <Paso q="¿2?" titulo="¿El contacto tiene la etiqueta «bot desactivado»?">
            Si sí → no le contesta a esa persona. El resto sigue funcionando normal.
          </Paso>
          <Paso q="¿3?" titulo="¿Mandó 10 o más mensajes en el último minuto?">
            Si sí → le pide que espere. Es una protección contra bucles y abusos.
          </Paso>
          <Paso q="¿4?" titulo="¿Mandó una imagen o un audio?">
            La imagen la describe y sigue normal. El audio hoy no lo puede transcribir y
            responde que no puede procesarlo.
          </Paso>
          <Paso q="¿5?" titulo="¿Pidió hablar con una persona?">
            Frases como «quiero hablar con alguien» o «agente humano» → avisa que pasa el
            mensaje a recepción y deja de contestar.
          </Paso>
          <Paso q="¿6?" titulo="¿Tiene una reserva activa?">
            Si sí → contesta <b className="text-[--color-cream]">Soporte</b>, aunque el
            mensaje mencione el evento.
          </Paso>
          <Paso q="¿7?" titulo={`¿Mencionó alguna palabra de ${nombreEvento}?`}>
            Si sí, y el evento está encendido → contesta el agente del evento.
          </Paso>
          <Paso q="→" titulo="Si ninguna aplicó, contesta Ventas">
            Y espera 30 segundos antes de mandar la respuesta: si el huésped manda tres
            mensajes seguidos, contesta una sola vez a todo junto.
          </Paso>
        </div>
      </Seccion>

      {/* ─── 7 ─── */}
      <Seccion id="funciones" eyebrow="Capítulo siete" titulo="Tabla de funciones">
        <div className="max-w-[68ch]">
          <P>
            Todo lo que hace el sistema, qué es cada cosa, y bajo qué condiciones actúa
            distinto.
          </P>
        </div>

        <div className="overflow-x-auto glass-lifted rounded-[16px] mt-7">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                {['Nombre de la función', 'Qué es', 'Funciones condicionales'].map((h) => (
                  <th
                    key={h}
                    className="text-left px-6 py-4 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[--color-cream-mute]"
                    style={{
                      background: 'rgba(0,0,0,0.18)',
                      boxShadow: '0 -1px 0 rgba(255,255,255,0.05) inset',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FUNCIONES.map((f) => (
                <tr key={f.nombre} style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.045) inset' }}>
                  <td className="align-top px-6 py-5 w-[21%]">
                    <div className="text-[14px] font-semibold text-[--color-cream] leading-[1.35]">
                      {f.nombre}
                    </div>
                    <span
                      className="inline-block mt-2 px-2 py-[2px] rounded-md text-[9.5px] font-bold uppercase tracking-[0.1em]"
                      style={{
                        color: TONO_DONDE[f.donde],
                        background: 'rgba(255,255,255,0.05)',
                      }}
                    >
                      {f.donde}
                    </span>
                  </td>
                  <td className="align-top px-6 py-5 w-[30%] text-[13.5px] leading-[1.6] text-[--color-cream-dim]">
                    {f.que}
                  </td>
                  <td className="align-top px-6 py-5 text-[13px] leading-[1.6] text-[--color-cream-dim]">
                    <ul className="m-0 pl-4 grid gap-2">
                      {f.cond.map((c, i) => (
                        <li key={i} className="marker:text-[--color-green]">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>

      {/* ─── 8 ─── */}
      <Seccion id="falla" eyebrow="Capítulo ocho" titulo="Cuando algo no funciona">
        <div className="max-w-[68ch]">
          <P>
            Estos chequeos resuelven la mayoría de los casos y ahorran tiempo antes de
            reportar nada.
          </P>

          <h3 className="mt-9 mb-1 text-[17px] font-medium text-[--color-cream]">
            El bot no le contesta a un huésped
          </h3>
          <P>
            En este orden: <strong className="text-[--color-cream]">¿el interruptor está en
            verde?</strong> Después,{' '}
            <strong className="text-[--color-cream]">
              ¿ese contacto tiene la etiqueta «bot desactivado»
            </strong>{' '}
            en GoHighLevel? Y por último,{' '}
            <strong className="text-[--color-cream]">¿mandó un audio?</strong> — hoy los
            audios no se procesan.
          </P>

          <h3 className="mt-9 mb-1 text-[17px] font-medium text-[--color-cream]">
            El bot no responde sobre el evento
          </h3>
          <P>
            Abrí la pestaña del evento y mirá tres cosas: que{' '}
            <strong className="text-[--color-cream]">el interruptor del evento esté encendido</strong>,
            que <strong className="text-[--color-cream]">tenga palabras clave cargadas</strong>, y
            que alguna de esas palabras sea la que el huésped realmente escribe. Y recordá:
            si el huésped tiene reserva activa, lo atiende Soporte por diseño.
          </P>

          <h3 className="mt-9 mb-1 text-[17px] font-medium text-[--color-cream]">
            El bot contesta algo incorrecto
          </h3>
          <P>
            Apagá el interruptor para frenar el daño. Corregí el texto con el Asistente IA,
            probalo en «Probar chat» hasta que responda bien, y volvé a encenderlo. En ese
            orden.
          </P>

          <h3 className="mt-9 mb-1 text-[17px] font-medium text-[--color-cream]">
            Cambié el texto y el bot sigue igual
          </h3>
          <P>
            Verificá que el botón «Guardar cambios» ya no esté encendido — si sigue en verde,
            el cambio no se guardó. Si sí se guardó, recordá que aplica desde el{' '}
            <strong className="text-[--color-cream]">siguiente</strong> mensaje.
          </P>

          <Nota titulo="Estado al día de hoy">
            <p>
              El bot está respondiendo por WhatsApp e Instagram. Quedan tres pendientes
              conocidos: los <strong>audios</strong> no se transcriben,{' '}
              <strong>Orbe</strong> no envía reservas desde el 10 de julio, y la sección de{' '}
              <strong>Revisión</strong> todavía no se publicó.
            </p>
          </Nota>
        </div>
      </Seccion>

      <p className="text-center text-[11px] font-medium text-[--color-cream-faint] tracking-[0.12em] uppercase">
        Manual del panel · Natural Lodge Caño Negro
      </p>
    </div>
  );
}

function AgenteCard({
  sigla,
  nombre,
  cuando,
  hace,
  evento,
}: {
  sigla: string;
  nombre: string;
  cuando: string;
  hace: string;
  evento?: boolean;
}) {
  return (
    <div className="glass-inset flex gap-4 px-5 py-4">
      <span
        className="w-[36px] h-[36px] shrink-0 grid place-items-center rounded-[11px] text-[11px] font-semibold tracking-wider"
        style={{
          background: 'linear-gradient(135deg, rgba(127,184,138,.22), rgba(127,184,138,.06))',
          color: 'var(--color-green-glow)',
        }}
      >
        {sigla}
      </span>
      <div>
        <div className="text-[14.5px] font-medium text-[--color-cream]">
          {nombre}
          {evento && (
            <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-[--color-green-glow]">
              configurable
            </span>
          )}
        </div>
        <p className="mt-1 mb-0 text-[13.5px] leading-[1.6] text-[--color-cream-dim]">
          <b className="text-[--color-cream-mute] font-medium">Cuándo:</b> {cuando}
        </p>
        <p className="mt-0.5 mb-0 text-[13.5px] leading-[1.6] text-[--color-cream-dim]">
          <b className="text-[--color-cream-mute] font-medium">Qué hace:</b> {hace}
        </p>
      </div>
    </div>
  );
}
