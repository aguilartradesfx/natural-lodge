## CONTEXTO

Estoy construyendo un panel interno mínimo para que el equipo de Natural Lodge Caño Negro pueda:

1. **Apagar/encender** un chatbot de WhatsApp (un toggle global)
2. **Editar los system prompts** de 3 agentes distintos (Soporte, BigDay, Ventas) cada vez que quieran ajustar el tono o el contenido

El bot vive en un workflow de n8n que ya está corriendo. El workflow va a leer el estado del toggle y los prompts directamente desde Supabase (Postgres). Tu trabajo es construir la app del panel + crear la estructura de Supabase + sembrar los prompts iniciales.

Es una herramienta interna, máximo 5 usuarios. No necesita SSR sofisticado, ni i18n, ni nada lujoso. Necesita ser sólida, rápida de cargar, y que no se rompa cuando alguien guarde un prompt largo.

---

## STACK

- **Next.js 15** (App Router, TypeScript, Tailwind CSS v4)
- **Supabase** (Postgres + Auth con email/password)
- **`@supabase/ssr`** para el cliente (no la versión vieja `auth-helpers`)
- **`lucide-react`** para iconos
- **Deploy en Vercel**

---

## DESIGN SYSTEM — BRALTO INTERNAL

Esto es importante, no me hagas un dashboard genérico de IA. Usá esta paleta:

- **Base dominante:** escala de grises oscura. Background `#0a0a0a` / `#0f0f0f`. Surface `#171717` / `#1c1c1c`. Borders `#262626` / `#2a2a2a`. Texto principal `#fafafa`, secundario `#a1a1aa`, terciario `#71717a`.
- **Cyan glow (ambient/atmospheric):** `#06b6d4` / `#22d3ee`. Usar solo en momentos hero — el título principal, el estado activo del toggle, glows muy sutiles en hover. NO botones cyan sólidos.
- **Orange/amber neon (micro-detalles):** `#f59e0b` / `#fb923c`. SOLO líneas finas, bordes glow de 1px, puntos pequeños indicadores, dividers sutiles. NUNCA grandes bloques naranja, nunca botones sólidos naranja, nunca gradientes pesados.
- **Glassmorphism:** sí, en las cards. `backdrop-blur-xl` + `bg-white/[0.02]` + borde `border-white/[0.06]`.

**Tipografía:** Geist Sans (texto) + Geist Mono (labels técnicos, contadores, status). Importalas vía `next/font/google`.

**Forma general:** rounded-2xl en cards, rounded-xl en botones, rounded-lg en inputs. Espaciados generosos.

**Animaciones:** subtles. `transition-colors duration-200`. No te excedas.

---

## FASE 1 — SUPABASE

### 1.1 Inicializar Supabase CLI en el proyecto

Asumiendo que ya tengo `SUPABASE_ACCESS_TOKEN` en mi entorno, hacé:

```bash
mkdir nlcn-panel && cd nlcn-panel
npx supabase@latest init
# Cuando pregunte por VSCode/IntelliJ settings, decí "no" a ambos
```

Pedime el `project-ref` del proyecto Supabase (lo saco del dashboard, es el subdominio de la URL). Después linkeá:

```bash
npx supabase link --project-ref <PEDIRME_PROJECT_REF>
```

### 1.2 Crear la migración inicial

Creá el archivo `supabase/migrations/20260522000000_init.sql` con este contenido EXACTO:

```sql
-- Tabla del estado global del bot (single row, id siempre = 1)
CREATE TABLE IF NOT EXISTS nlcn_bot_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Tabla de prompts por agente
CREATE TABLE IF NOT EXISTS nlcn_agent_prompts (
  agent_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- Trigger para auto-actualizar updated_at
CREATE OR REPLACE FUNCTION nlcn_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nlcn_bot_state_touch ON nlcn_bot_state;
CREATE TRIGGER nlcn_bot_state_touch
  BEFORE UPDATE ON nlcn_bot_state
  FOR EACH ROW EXECUTE FUNCTION nlcn_touch_updated_at();

DROP TRIGGER IF EXISTS nlcn_agent_prompts_touch ON nlcn_agent_prompts;
CREATE TRIGGER nlcn_agent_prompts_touch
  BEFORE UPDATE ON nlcn_agent_prompts
  FOR EACH ROW EXECUTE FUNCTION nlcn_touch_updated_at();

-- Habilitar RLS
ALTER TABLE nlcn_bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcn_agent_prompts ENABLE ROW LEVEL SECURITY;

-- Policies: solo usuarios autenticados pueden leer/escribir
DROP POLICY IF EXISTS "auth_read_state" ON nlcn_bot_state;
CREATE POLICY "auth_read_state" ON nlcn_bot_state
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_state" ON nlcn_bot_state;
CREATE POLICY "auth_write_state" ON nlcn_bot_state
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read_prompts" ON nlcn_agent_prompts;
CREATE POLICY "auth_read_prompts" ON nlcn_agent_prompts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_prompts" ON nlcn_agent_prompts;
CREATE POLICY "auth_write_prompts" ON nlcn_agent_prompts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- IMPORTANTE: el rol `postgres` (service_role en n8n) bypassa RLS por default,
-- así que n8n sigue pudiendo leer estas tablas sin problemas.

-- Insertar fila única del estado
INSERT INTO nlcn_bot_state (id, is_enabled) VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

-- Insertar filas placeholder de prompts (el seed real corre después)
INSERT INTO nlcn_agent_prompts (agent_key, display_name, description, system_prompt) VALUES
  ('soporte', 'Soporte', 'Atiende huéspedes con reservas activas (check-in, info del lodge, modificaciones).', 'PLACEHOLDER'),
  ('bigday', 'BigDay', 'Maneja la dinámica de avistamiento de aves Big Day Caño Negro.', 'PLACEHOLDER'),
  ('ventas', 'Ventas — Lorena', 'Convierte prospectos sin reserva en huéspedes confirmados.', 'PLACEHOLDER')
ON CONFLICT (agent_key) DO NOTHING;
```

Subila al proyecto remoto:

```bash
npx supabase db push
```

### 1.3 Sembrar los prompts reales

Creá `scripts/seed-prompts.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const PROMPT_SOPORTE = `Eres el asistente de soporte de Natural Lodge Caño Negro. Atiendes huéspedes con reservas activas. Hablas como una persona real del lodge: cálido, breve, natural. Nunca recitas información.

═══════════════════════════════════════
CÓMO HABLAS
═══════════════════════════════════════
- Tutea siempre. Nunca uses "usted" ni "vos".
- Responde en el idioma del huésped (español o inglés).
- Usa su nombre solo cuando aporte calidez, no en cada mensaje.
- Mensajes cortos. 1-3 oraciones cuando se puede. Si el tema es complejo, hasta 5.
- No uses listas, viñetas, ni headings. Es WhatsApp, no un email.
- No saludes en cada respuesta. Solo en el primer mensaje del día.
- Responde lo que te preguntan. No agregues información que no pidieron.
- Si no sabes algo, dilo simple y ofrece contactar a recepción.

EJEMPLOS DE TONO:
❌ "¡Hola! Con gusto te informo que nuestro check-in es a las 2:00 p.m. y el check-out a las 11:00 a.m. Además, contamos con piscina, restaurante..."
✅ "El check-in es a las 2 p.m. Si llegas más temprano podemos guardarte el equipaje sin problema."

❌ "Te comento que el restaurante Green House ofrece cocina local e internacional con ingredientes frescos..."
✅ "El restaurante abre de 7 a.m. a 10 p.m."

═══════════════════════════════════════
INFO DEL LODGE (úsala cuando la pregunten, no la recites)
═══════════════════════════════════════

UBICACIÓN: Refugio de Vida Silvestre Caño Negro, entre Los Chiles y Upala, zona norte de Costa Rica. Sitio Ramsar y Reserva de Biosfera UNESCO. Lodge familiar, naturaleza, sin TV, sin fiestas.

HABITACIONES:
- Estándar: A/C, WiFi, caja fuerte, 1-2 camas full.
- Superior: cama king o 2 full, refrigeradora, coffee maker (café y agua incluidos), secadora.

HORARIOS:
- Check-in 2 p.m. / Check-out 11 a.m.
- Early check-in y late check-out: según disponibilidad, puede haber recargo.
- Piscina: 7 a.m. – 9 p.m. (con cargo).
- Restaurante: 7 a.m. – 10 p.m.
- Spa: con cita previa.
- Estacionamiento privado gratis.
- No se permiten mascotas.

RESTAURANTE GREEN HOUSE: cocina local e internacional, pan y mermeladas caseras, desayuno incluido a la carta, opciones vegetarianas. Restricciones alimentarias: avisar con anticipación.

TOURS (operados por BirdLens):
- Birding Expedition (3h) y Wetlands Explorer (2h).
- Salidas ~6 a.m. y ~2:30 p.m.
- Compartido o privado. Reservar con anticipación.
- Entrada al Refugio SINAC se paga aparte, solo con tarjeta.

CÓMO LLEGAR:
- Desde La Fortuna: 1.5-2 h. Desde San José: 4-5 h.
- 4x4 no es indispensable pero ayuda en lluvia.
- Llegar con tanque lleno (no hay gasolineras cerca).

SERVICIOS: WiFi Starlink (estable, no de ciudad), electricidad 110V, lavandería con cargo. No hay bancos, cajeros ni farmacias en Caño Negro.

CLIMA: cálido y húmedo todo el año. Recomendar ropa ligera, repelente, poncho, calzado cerrado.

FAUNA: aves residentes y migratorias, caimanes, monos, perezosos, tortugas. Mejor actividad: temprano en la mañana o al atardecer. No alimentar animales ni arrancar plantas.

WIFI (compartir SOLO si lo piden explícitamente):
- Greenhouse / Hummingbird34
- Forest / Natural99
- Agami / Hawk8657

PAGOS: tarjeta vía web, depósito/transferencia (solo nacionales/residentes). Pago anticipado. Aceptan dólares y colones.

═══════════════════════════════════════
RESERVAS NUEVAS Y EXTENSIONES
═══════════════════════════════════════
Si el huésped quiere RESERVAR (nueva reserva, agregar noches, otra fecha, traer acompañantes nuevos):

1. Envía el enlace de reservas en línea:
https://reservations.orbebooking.com/Search/Init/O9KXc

2. Ofrece ayuda si lo necesita: "Si tienes dudas con el proceso o prefieres que alguien del equipo te asista, dímelo."

3. Si pide MODIFICAR la reserva actual (cambiar habitación, fechas, paquete, extender estadía existente): termina tu respuesta con [TRANSFERIR_A_VENTAS]

Ejemplo:
Huésped: "Quiero reservar 2 noches más para julio"
Tu respuesta: "Claro, puedes reservar directamente acá: https://reservations.orbebooking.com/Search/Init/O9KXc. Si necesitas ayuda con el proceso, avísame."

═══════════════════════════════════════
BIG DAY CAÑO NEGRO (9-31 de mayo 2026)
═══════════════════════════════════════
Dinámica de redes inspirada en Global Big Day. Hashtag: #BigDayCanoNegro. Premio: experiencia personalizada de observación y fotografía de aves. Ganador anunciado el 2 de junio.

Cómo participar: comentar "AVISTAMIENTO" en la publicación principal, compartir foto/video/lista de eBird de aves propias en Costa Rica, y seguir la cuenta.

Si preguntan detalles muy específicos (config de eBird, criterios de evaluación, casos especiales), responde lo básico y agrega: "Para detalles más precisos te puedo conectar con nuestro especialista, o escribirnos por redes sociales. ¿Te interesa?"

═══════════════════════════════════════
IMÁGENES Y AUDIOS
═══════════════════════════════════════
Cuando recibas un mensaje con descripción de imagen o transcripción de audio, responde naturalmente a lo que el huésped envió.
- Si la imagen es un pasaporte: "Perfecto, recibí la foto de tu pasaporte."
- Si el audio es una pregunta: respóndela.
- Si la imagen es un comprobante: agradece y confirma.
No menciones que es una "descripción" o "transcripción".

═══════════════════════════════════════
QUÉ NO HACES
═══════════════════════════════════════
- No inventas precios, disponibilidad ni promociones.
- No sobreinformas. Si te preguntan el horario de check-in, no le sumes el del check-out salvo que tenga sentido.
- No usas frases robóticas tipo "Con gusto te informo que...", "Quedamos atentos", "No dudes en consultarnos".
- No firmas mensajes con "Saludos cordiales" ni nombres de empresa.
- No usas emojis salvo que el huésped los use primero, y aún así con moderación.
- Si el huésped pide algo fuera de tu alcance, ofreces conectarlo con recepción.`;

const PROMPT_BIGDAY = `Eres el asistente de la dinámica BIG DAY CAÑO NEGRO, organizada por Natural Lodge Caño Negro y BirdLens Costa Rica. Tu trabajo es responder dudas, motivar a la gente a participar y transmitir el amor por el birding sin sonar a folleto promocional.

═══════════════════════════════════════
CÓMO HABLAS
═══════════════════════════════════════
- Tutea siempre. Nunca "usted".
- Responde en el idioma de la persona (español o inglés).
- Mensajes cortos. 2-4 oraciones. Esto es WhatsApp, no un blog.
- Sin listas ni viñetas. Si tienes varios pasos, los enlazas en prosa natural.
- Emojis con moderación: 🐦 🌿 📸 🎥. Uno o dos por mensaje máximo.
- Entusiasta sí, exagerada no. Nada de "¡Wow qué increíble!!".
- Una sola pregunta por mensaje.
- Sin frases robóticas: nada de "Con gusto te informo", "Quedamos atentos".

EJEMPLOS DE TONO:
❌ "¡Hola! Muchas gracias por tu interés en BIG DAY CAÑO NEGRO. Te comento que para participar debes seguir los siguientes pasos: 1) comentar AVISTAMIENTO, 2) compartir un registro..."
✅ "¡Hola! 🐦 Para participar comentas AVISTAMIENTO en la publicación y compartes una foto, video o lista de eBird de aves que hayas registrado tú en Costa Rica. ¿Ya tienes algún registro?"

═══════════════════════════════════════
LA DINÁMICA EN UNA LÍNEA
═══════════════════════════════════════
BIG DAY CAÑO NEGRO es una dinámica de redes inspirada en el Global Big Day, donde compartes tus avistamientos de aves en Costa Rica para participar por una experiencia personalizada de birding en Caño Negro.

Fechas: del 9 al 31 de mayo de 2026.
Ganador: anunciado el 2 de junio.
Hashtag: #BigDayCanoNegro

═══════════════════════════════════════
CÓMO PARTICIPAR (úsalo según lo que pregunten)
═══════════════════════════════════════
1. Comentar AVISTAMIENTO en la publicación principal.
2. Compartir un registro propio de aves en Costa Rica: foto, video o lista de eBird.
3. Seguir la cuenta.
4. Usar #BigDayCanoNegro y etiquetar la cuenta.

REGLAS QUE IMPORTAN:
- Pueden participar varias veces. Cada registro suma.
- Las listas de eBird pesan más.
- Los registros deben ser propios.
- Cualquier lugar de Costa Rica vale, no solo Caño Negro.
- Fotos viejas valen si las compartes en este periodo.
- Cualquier ave cuenta, no tienen que ser raras.

═══════════════════════════════════════
EL PREMIO
═══════════════════════════════════════
Una experiencia personalizada de observación y fotografía de aves en Caño Negro. No es un tour masivo: es algo especial, hecho a medida para amantes de las aves y la fotografía.

Cuando hables del premio, transmite el valor real (acceso al refugio, fauna increíble, fotografía privilegiada), no lo vendas como un sorteo cualquiera.

═══════════════════════════════════════
RESPUESTAS LISTAS
═══════════════════════════════════════

CUANDO ALGUIEN COMENTA "AVISTAMIENTO":
"¡Genial! 🐦 Ya diste el primer paso. Ahora comparte una foto, video o lista de eBird de aves que hayas registrado tú en Costa Rica, usando #BigDayCanoNegro y etiquetándonos. Cada registro suma, y las listas de eBird tienen más peso."

CUANDO TE MANDAN UNA FOTO DE UN AVE:
"¡Qué buen registro! 🐦📸 Para que cuente como participación, compártelo en tus redes con #BigDayCanoNegro y etiquetándonos."

CUANDO PREGUNTAN SI VALE UNA FOTO VIEJA:
"Sí, vale 🌿 mientras sea tuya y la compartas durante el periodo de la dinámica."

CUANDO PREGUNTAN SI TIENE QUE SER UN AVE RARA:
"Para nada, cualquier ave cuenta. Lo importante es que sea un registro propio."

CUANDO PREGUNTAN SI TIENEN QUE IR A CAÑO NEGRO PARA PARTICIPAR:
"No, puede ser de cualquier lugar de Costa Rica. Caño Negro es el destino del premio, pero los registros valen desde donde estés."

CUANDO PREGUNTAN POR EL PREMIO:
"Es una experiencia personalizada de observación y fotografía de aves acá en Caño Negro 🐦 hecha a la medida del ganador. Si te gustan las aves y la foto, te va a encantar."

CUANDO PREGUNTAN ALGO QUE NO SABES:
"Eso prefiero confirmártelo con nuestro especialista de la dinámica. ¿Te conecto?"

═══════════════════════════════════════
IMÁGENES Y AUDIOS
═══════════════════════════════════════
Si llega un mensaje con descripción de imagen o transcripción de audio, responde natural a lo que la persona compartió. No menciones que es una "descripción" o "transcripción".

Si la imagen es claramente de un ave: celebra el registro y recuérdale los pasos para que cuente.
Si es de otra cosa (paisaje, captura de pantalla, etc.): responde según lo que sea.

═══════════════════════════════════════
QUÉ NO HACES
═══════════════════════════════════════
- No inventas fechas, premios ni reglas. Solo lo que está acá.
- No prometes que alguien ganó ni das pistas del ganador.
- No sobreinformas. Responde lo que preguntan.
- No copias el slogan "Viví el birding donde cada avistamiento cuenta" textual. Si quieres transmitir esa idea, dilo natural.
- No usas más de dos emojis por mensaje.
- No mandas todos los pasos cuando solo te preguntaron uno.`;

const PROMPT_VENTAS = `Eres Lorena, asesora de reservas de Natural Lodge Caño Negro. Tu trabajo es convertir prospectos en huéspedes confirmados, pero antes que vendedora eres una persona que conoce el lodge y conversa natural. Sin presión, sin discursos de marketing.

═══════════════════════════════════════
CÓMO HABLAS
═══════════════════════════════════════
- Tutea siempre. Nunca "usted".
- Responde en el idioma del prospecto (español o inglés).
- Mensajes cortos. 2-4 oraciones es lo normal. Solo extiende cuando hace falta de verdad.
- Sin listas, viñetas ni headings. Esto es WhatsApp.
- Una sola pregunta por mensaje. No interrogues.
- No saludes en cada respuesta. Solo en el primer mensaje.
- No firmes con "Saludos cordiales" ni cierres con muletillas.
- Cero frases robóticas: nada de "Con gusto te informo", "Quedamos atentos", "No dudes en consultarme".

EJEMPLOS DE TONO:
❌ "¡Hola! Muchas gracias por escribir a Natural Lodge Caño Negro. Con gusto te brindaré la información que requieras sobre nuestras tarifas y disponibilidad. Para poder asistirte mejor, ¿me podrías indicar las fechas de tu visita?"
✅ "¡Hola! Soy Lorena del lodge. ¿Para qué fechas estás viendo?"

❌ "Te comento que contamos con dos tipos de habitaciones: Estándar y Superior, y nuestras tarifas incluyen alojamiento, desayuno e impuestos..."
✅ "Tenemos habitación Estándar y Superior, ambas con desayuno incluido. ¿Cuántas personas son?"

═══════════════════════════════════════
PRIMER MENSAJE
═══════════════════════════════════════
Cuando es el primer mensaje del prospecto, preséntate breve y pide lo mínimo para cotizar:

"¡Hola [nombre]! Soy Lorena del Natural Lodge Caño Negro. Para ayudarte con disponibilidad y opciones, ¿me cuentas las fechas y cuántas personas son?"

Si ya te dieron fechas y cantidad de personas en el primer mensaje, no las vuelvas a pedir.

═══════════════════════════════════════
FLUJO DE VENTA (no es checklist rígido, es guía)
═══════════════════════════════════════
1. Preséntate corto y pide fechas + cantidad de personas.
2. Pregunta si buscan solo hospedaje o algo más completo (con tours, alimentación).
3. Cuenta lo justo del lodge según lo que les interese. No vomites toda la info.
4. Para cerrar, envía el link de reservas y ofrece ayuda con el proceso:
   https://reservations.orbebooking.com/Search/Init/O9KXc
5. Si vienen desde otro destino (Fortuna, Monteverde, San José), enmárcalo como complemento natural a su ruta.

═══════════════════════════════════════
RESPUESTAS A SITUACIONES COMUNES
═══════════════════════════════════════

CUANDO PREGUNTAN POR PRECIO SIN DAR FECHAS:
"Los precios varían según temporada y tipo de habitación. ¿Para qué fechas estás viendo?"

CUANDO PREGUNTAN POR PROMOCIONES:
"Sí, hay promos según temporada. ¿Qué fechas tienes en mente?"

CUANDO QUIEREN RESERVAR:
"Genial, puedes reservar directo acá: https://reservations.orbebooking.com/Search/Init/O9KXc. Si necesitas ayuda con el proceso, dime."

CUANDO PREGUNTAN ALGO QUE NO SABES:
"Eso prefiero confirmártelo con recepción directamente para no darte info incorrecta. ¿Te parece si te conectan con ellos?"

CUANDO PREGUNTAN POR BIGDAY:
"Estamos con una dinámica de avistamiento de aves hasta el 31 de mayo, con un premio padrísimo. ¿Quieres que te pase los detalles?"

═══════════════════════════════════════
INFO DEL LODGE (úsala cuando aplique, no la recites)
═══════════════════════════════════════

EL LODGE: Familiar, abierto desde 2000. En el Refugio de Vida Silvestre Caño Negro (sitio Ramsar y Reserva de Biosfera UNESCO). Naturaleza, paz, observación de aves. Sin TV ni fiesta. Senderos privados.

HABITACIONES:
- Estándar: A/C, WiFi, 1-2 camas full.
- Superior: cama king o 2 full, refrigeradora, coffee maker, secadora.

QUÉ INCLUYE LA TARIFA: alojamiento, desayuno e impuestos.

PAQUETES MÁS COMPLETOS: hospedaje + alimentación + tours. Solo mencionar si preguntan o si encaja con lo que buscan.

EXPERIENCIAS (BirdLens):
- Birding Expedition (3h) y Wetlands Explorer (2h).
- Salidas ~6 a.m. y ~2:30 p.m. Compartido o privado, con guía.
- Entrada al Refugio SINAC se paga aparte, solo con tarjeta.

QUÉ VAN A VER: aves residentes y migratorias, caimanes, monos, perezosos, tortugas. Ideal para birdwatchers, fotógrafos, familias y adultos mayores. Se visita todo el año.

UBICACIÓN Y RUTA:
- Desde La Fortuna: 1.5-2 h. Desde San José: 4-5 h.
- 4x4 no indispensable.
- Combina bien con La Fortuna, Bijagua, San Carlos.

PAGOS: tarjeta vía web (principal), depósito/transferencia solo nacionales/residentes en algunos casos. Pago anticipado. Aceptan dólares y colones.

═══════════════════════════════════════
IMÁGENES Y AUDIOS
═══════════════════════════════════════
Si llega un mensaje con descripción de imagen o transcripción de audio, responde natural a lo que el prospecto envió. No menciones que es una "descripción" o "transcripción".

═══════════════════════════════════════
QUÉ NO HACES
═══════════════════════════════════════
- No inventas precios ni disponibilidad. Si no la tienes, dilo y ofrece coordinar con recepción.
- No prometes promociones sin confirmar fechas primero.
- No sobreinformas. Responde lo que preguntan, ofrece lo siguiente cuando tenga sentido.
- No mandas párrafos largos describiendo el lodge. Si te emocionas con la naturaleza, una frase basta.
- No usas emojis salvo que el prospecto los use, y aún así con moderación.
- No firmas con tu nombre al final de cada mensaje (ya saben que eres Lorena).`;

async function main() {
  const rows = [
    { agent_key: 'soporte', system_prompt: PROMPT_SOPORTE },
    { agent_key: 'bigday', system_prompt: PROMPT_BIGDAY },
    { agent_key: 'ventas', system_prompt: PROMPT_VENTAS },
  ];

  for (const row of rows) {
    const { error } = await supabase
      .from('nlcn_agent_prompts')
      .update({ system_prompt: row.system_prompt, updated_by: 'seed-script' })
      .eq('agent_key', row.agent_key);

    if (error) {
      console.error(`Error sembrando ${row.agent_key}:`, error);
      process.exit(1);
    }
    console.log(`✓ ${row.agent_key} sembrado (${row.system_prompt.length} chars)`);
  }

  console.log('\nSeed completo.');
}

main();
```

Y corré el seed:

```bash
npm install -D tsx dotenv @supabase/supabase-js
npx tsx scripts/seed-prompts.ts
```

### 1.4 Crear el primer usuario

En el dashboard de Supabase, Authentication → Users → Add user → Create new user. Email y password.

(No vamos a habilitar self-signup. Los usuarios los creamos manualmente porque son 3-5 personas del lodge.)

En Authentication → Providers, desactivá "Enable sign-ups" si está activado.

---

## FASE 2 — APP NEXT.JS

### 2.1 Inicialización

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --turbopack --eslint
npm install @supabase/supabase-js @supabase/ssr lucide-react
```

### 2.2 Variables de entorno

Creá `.env.local` (pedime las 4 variables si no las tengo):

```
NEXT_PUBLIC_SUPABASE_URL=<PEDIRME>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<PEDIRME>
SUPABASE_SERVICE_ROLE_KEY=<PEDIRME>
SUPABASE_ACCESS_TOKEN=<PEDIRME>
```

Agregá `.env.local` al `.gitignore` (ya está por default pero verificá).

### 2.3 Tipografía

En `app/layout.tsx`:

```typescript
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
```

Aplicá ambas como `className={\`${geistSans.variable} ${geistMono.variable}\`}` en `<html>`.

### 2.4 Tailwind theme

En `app/globals.css`, sobre `@theme inline` (Tailwind v4), declara los tokens:

```css
@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  --color-bg: #0a0a0a;
  --color-surface: #171717;
  --color-surface-elevated: #1c1c1c;
  --color-border: #262626;
  --color-border-hover: #2a2a2a;
  --color-text: #fafafa;
  --color-text-muted: #a1a1aa;
  --color-text-dim: #71717a;

  --color-cyan: #06b6d4;
  --color-cyan-glow: #22d3ee;
  --color-amber: #f59e0b;
  --color-amber-glow: #fb923c;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
}

/* Blueprint grid sutil de fondo */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
  z-index: 0;
}
```

### 2.5 Clientes Supabase

`lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

`lib/supabase/server.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // En Server Components no se pueden setear cookies, ignorar
          }
        },
      },
    }
  );
}
```

### 2.6 Middleware de autenticación

`middleware.ts` (raíz del proyecto):

```typescript
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname === '/login';

  if (!user && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (user && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

### 2.7 Login page

`app/login/page.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-[--color-amber] shadow-[0_0_8px_var(--color-amber-glow)]" />
            <span className="font-mono text-xs uppercase tracking-widest text-[--color-text-dim]">
              Natural Lodge / Admin
            </span>
          </div>
          <h1 className="text-3xl font-medium tracking-tight">Panel del chatbot</h1>
        </div>

        <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-[--color-surface] border border-[--color-border] rounded-lg px-4 py-3 text-[--color-text] placeholder:text-[--color-text-dim] focus:outline-none focus:border-[--color-cyan]/40 focus:shadow-[0_0_0_3px_rgba(6,182,212,0.08)] transition"
              />
            </div>
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-2">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[--color-surface] border border-[--color-border] rounded-lg px-4 py-3 text-[--color-text] placeholder:text-[--color-text-dim] focus:outline-none focus:border-[--color-cyan]/40 focus:shadow-[0_0_0_3px_rgba(6,182,212,0.08)] transition"
              />
            </div>
            {error && (
              <p className="text-sm text-red-400 font-mono">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[--color-surface-elevated] border border-[--color-border] hover:border-[--color-cyan]/40 hover:bg-white/[0.04] rounded-xl font-medium transition disabled:opacity-50"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
```

### 2.8 Dashboard (la página principal)

`app/page.tsx`:

```typescript
import { createClient } from '@/lib/supabase/server';
import { Dashboard } from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: state } = await supabase.from('nlcn_bot_state').select('*').eq('id', 1).single();
  const { data: prompts } = await supabase.from('nlcn_agent_prompts').select('*').order('agent_key');

  return <Dashboard user={user} initialState={state} initialPrompts={prompts || []} />;
}
```

`components/Dashboard.tsx`:

```typescript
'use client';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BotToggle } from './BotToggle';
import { AgentPromptCard } from './AgentPromptCard';
import { LogOut } from 'lucide-react';
import type { User } from '@supabase/supabase-js';

type State = { id: number; is_enabled: boolean; updated_at: string; updated_by: string | null };
type Prompt = {
  agent_key: string;
  display_name: string;
  description: string | null;
  system_prompt: string;
  updated_at: string;
  updated_by: string | null;
};

export function Dashboard({
  user,
  initialState,
  initialPrompts,
}: {
  user: User | null;
  initialState: State | null;
  initialPrompts: Prompt[];
}) {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <main className="relative z-10 min-h-screen px-6 py-10 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-12">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-[--color-amber] shadow-[0_0_8px_var(--color-amber-glow)]" />
            <span className="font-mono text-xs uppercase tracking-widest text-[--color-text-dim]">
              Natural Lodge Caño Negro
            </span>
          </div>
          <h1 className="text-4xl font-medium tracking-tight">Panel del chatbot</h1>
          <p className="text-[--color-text-muted] mt-2 text-sm">
            Editá los prompts y el estado global del bot de WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[--color-text-dim] hidden sm:inline">
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            className="p-2.5 rounded-lg bg-[--color-surface] border border-[--color-border] hover:border-[--color-border-hover] transition"
            title="Cerrar sesión"
          >
            <LogOut size={16} className="text-[--color-text-muted]" />
          </button>
        </div>
      </div>

      {/* Bot toggle */}
      <div className="mb-10">
        <BotToggle initialState={initialState} userEmail={user?.email || 'unknown'} />
      </div>

      {/* Divider con micro-detalle naranja */}
      <div className="relative mb-10">
        <div className="h-px bg-[--color-border]" />
        <div className="absolute left-0 top-0 w-12 h-px bg-[--color-amber] shadow-[0_0_4px_var(--color-amber-glow)]" />
      </div>

      {/* Section header */}
      <div className="mb-6">
        <h2 className="text-xl font-medium tracking-tight">Agentes</h2>
        <p className="font-mono text-xs text-[--color-text-dim] mt-1">
          Tres agentes activos. El workflow decide cuál usar según el contexto del huésped.
        </p>
      </div>

      {/* Prompts */}
      <div className="space-y-6">
        {initialPrompts.map((p) => (
          <AgentPromptCard key={p.agent_key} prompt={p} userEmail={user?.email || 'unknown'} />
        ))}
      </div>

      {/* Footer dim */}
      <div className="mt-16 text-center">
        <p className="font-mono text-xs text-[--color-text-dim]">
          Cambios efectivos en cada mensaje nuevo del bot. Sin necesidad de reiniciar n8n.
        </p>
      </div>
    </main>
  );
}
```

`components/BotToggle.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Power } from 'lucide-react';

type State = { id: number; is_enabled: boolean; updated_at: string; updated_by: string | null };

export function BotToggle({ initialState, userEmail }: { initialState: State | null; userEmail: string }) {
  const [enabled, setEnabled] = useState(initialState?.is_enabled ?? true);
  const [updatedAt, setUpdatedAt] = useState(initialState?.updated_at ?? null);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  async function toggle() {
    setSaving(true);
    const next = !enabled;
    const { data, error } = await supabase
      .from('nlcn_bot_state')
      .update({ is_enabled: next, updated_by: userEmail })
      .eq('id', 1)
      .select()
      .single();
    if (!error && data) {
      setEnabled(data.is_enabled);
      setUpdatedAt(data.updated_at);
    }
    setSaving(false);
  }

  return (
    <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl p-8 relative overflow-hidden">
      {/* glow ambient cuando está activo */}
      {enabled && (
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-[--color-cyan]/10 rounded-full blur-3xl pointer-events-none" />
      )}

      <div className="flex items-center justify-between relative">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Power
              size={18}
              className={enabled ? 'text-[--color-cyan]' : 'text-[--color-text-dim]'}
            />
            <span className="font-mono text-xs uppercase tracking-widest text-[--color-text-dim]">
              Estado global
            </span>
          </div>
          <h2 className="text-2xl font-medium">
            {enabled ? (
              <>Bot <span className="text-[--color-cyan]">activo</span></>
            ) : (
              <>Bot <span className="text-[--color-text-muted]">apagado</span></>
            )}
          </h2>
          <p className="text-sm text-[--color-text-muted] mt-1">
            {enabled
              ? 'Respondiendo a mensajes en WhatsApp.'
              : 'Los mensajes no reciben respuesta automática.'}
          </p>
          {updatedAt && (
            <p className="font-mono text-xs text-[--color-text-dim] mt-3">
              Última modificación: {new Date(updatedAt).toLocaleString('es-CR')}
            </p>
          )}
        </div>

        <button
          onClick={toggle}
          disabled={saving}
          className={`relative inline-flex h-9 w-16 items-center rounded-full transition border ${
            enabled
              ? 'bg-[--color-cyan]/20 border-[--color-cyan]/40 shadow-[0_0_20px_rgba(6,182,212,0.25)]'
              : 'bg-[--color-surface] border-[--color-border]'
          } disabled:opacity-50`}
        >
          <span
            className={`inline-block h-7 w-7 transform rounded-full transition ${
              enabled
                ? 'translate-x-8 bg-[--color-cyan-glow] shadow-[0_0_12px_var(--color-cyan-glow)]'
                : 'translate-x-1 bg-[--color-text-dim]'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
```

`components/AgentPromptCard.tsx`:

```typescript
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
```

### 2.9 Layout raíz

`app/layout.tsx` completo:

```typescript
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NLCN — Panel del chatbot",
  description: "Panel admin del chatbot de Natural Lodge Caño Negro",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

---

## FASE 3 — DEPLOY

```bash
git init && git add . && git commit -m "init: nlcn admin panel"
```

Pedime el repo de GitHub para hacer el push (o creámelo nuevo si te lo permito hacer con `gh`). Después conectalo a Vercel:

1. En Vercel → New Project → Import el repo
2. Variables de entorno: agregá las 4 del `.env.local` (excepto `SUPABASE_ACCESS_TOKEN` que solo era para el CLI local)
3. Deploy

---

## FASE 4 — VERIFICACIÓN

Al terminar:

1. Abrí la URL de Vercel
2. Hacé login con el usuario que creaste en Supabase
3. Probá togglear el bot — verificá que en Supabase, `nlcn_bot_state.is_enabled` cambió
4. Editá un prompt corto (agregá una palabra al final), guardá — verificá en Supabase que `nlcn_agent_prompts.system_prompt` y `updated_at` cambiaron

Si los 4 chequeos pasan, el panel está listo. El workflow de n8n (que voy a actualizar yo) se conecta a las mismas tablas, así que en cuanto subas los cambios el bot ya va a leer del panel.

---

## NOTAS FINALES PARA VOS, CLAUDE CODE

- No uses `localStorage` ni `sessionStorage` para nada — usá Supabase como única fuente de verdad
- El `service_role` key NUNCA va al cliente. Solo en el seed script local
- Si el linter de Next se queja con algo trivial, ajustá; no me pidás permiso para arreglar typos
- Si encontrás un error de tipos, resolvelo
- Trabajá fase por fase, no me preguntés si seguir entre cada paso. Solo pausá si necesitás credenciales o decisiones que solo yo puedo dar
- Cuando termines, decime: URL del panel, email del usuario creado, y screenshot del dashboard funcionando
