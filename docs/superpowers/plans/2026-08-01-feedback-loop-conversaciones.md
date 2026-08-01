# Ciclo de retroalimentación del chatbot — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resumir automáticamente cada conversación del chatbot, ponerla en una bandeja de revisión humana, y convertir el feedback en reglas que — tras dos aprobaciones explícitas — se integran al `system_prompt` del agente con historial restaurable.

**Architecture:** Un cron parte `chatbot_logs` en *episodios* (bloques separados por ≥6h de silencio), los resume con Claude y los guarda en `nlcn_conversation_reviews`. El panel muestra una bandeja priorizada; el comentario humano se convierte en una fila de `nlcn_learned_rules` (compuerta 1) y, al acumularse, en un diff contra el prompt (compuerta 2). Cada aplicación guarda un snapshot en `nlcn_prompt_versions`. Toda la lógica vive en módulos de `lib/`; las rutas API son envolturas delgadas, lo que las hace testeables mockeando el módulo.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + service_role), `@anthropic-ai/sdk`, Tailwind v4, vitest.

**Spec:** [`docs/superpowers/specs/2026-08-01-feedback-loop-conversaciones-design.md`](../specs/2026-08-01-feedback-loop-conversaciones-design.md)

---

## Global Constraints

- **Esta NO es la versión de Next.js que conocés.** Antes de escribir código de rutas o páginas, leé la guía correspondiente en `node_modules/next/dist/docs/`. Ya verificado y obligatorio en este plan: **`params` es una `Promise`** tanto en Route Handlers (`{ params }: { params: Promise<{ id: string }> }` → `const { id } = await params`) como en páginas (`params: Promise<{...}>`).
- **Idioma:** todo el código, comentarios, mensajes de commit y texto de UI en **español**. Los comentarios explican el *porqué*, no el *qué* — seguí la densidad de comentarios de los archivos vecinos.
- **Modelos Claude — IDs exactos, sin sufijo de fecha:** `claude-sonnet-5` (resúmenes), `claude-opus-5` (reglas y consolidación). No usar `claude-sonnet-4-6` para lo nuevo; ese sigue siendo el del chatbot en producción.
- **Nunca tocar `ANTHROPIC_MODEL`**: es el modelo del chatbot que responde a huéspedes reales. Las funciones nuevas usan `ANTHROPIC_REVIEW_MODEL` y `ANTHROPIC_RULES_MODEL`.
- **`createAdminClient()` es solo server-side.** Todo archivo de `lib/` que lo importe lleva `import 'server-only';` en la primera línea (ver [`lib/chat-memory.ts`](../../../lib/chat-memory.ts)).
- **Rutas API protegidas** con `requireUser()` de [`lib/api-auth.ts`](../../../lib/api-auth.ts), salvo `/api/cron/*` que usa `CRON_SECRET`.
- **`/api/cron/*` ya está en `PUBLIC_API_PREFIXES`** de [`middleware.ts`](../../../middleware.ts): no hay que tocar el middleware.
- **Errores de trabajo en segundo plano** se registran con `logWorkflowError` de [`lib/error-log.ts`](../../../lib/error-log.ts). Nunca lanza.
- **Migraciones idempotentes:** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`.
- **Tests:** `vitest`, colocados junto al módulo (`lib/x.ts` → `lib/x.test.ts`). El `include` de [`vitest.config.ts`](../../../vitest.config.ts) es `['lib/**/*.test.ts', 'app/**/*.test.ts']`.
- **Mocks: usá siempre `vi.hoisted`.** El factory de `vi.mock` se eleva por encima de las declaraciones del archivo, así que **no puede cerrar sobre un `const` normal** — falla con `Cannot access 'X' before initialization`. Los bloques de test de este plan usan la forma corta por legibilidad; al escribirlos, convertilos:

  ```ts
  // ✗ Rompe en tiempo de ejecución
  const create = vi.fn();
  vi.mock('@/lib/anthropic', () => ({ anthropic: { messages: { create } } }));

  // ✓ Correcto
  const { create } = vi.hoisted(() => ({ create: vi.fn() }));
  vi.mock('@/lib/anthropic', () => ({ anthropic: { messages: { create } } }));
  ```

  Lo mismo aplica a cualquier objeto de estado mutable que use el doble de Supabase.
- **Tipar los parámetros de los mocks** que después se inspeccionan: `vi.fn(async () => {})` deja `mock.calls[0][0]` sin tipo y `tsc` lo rechaza. Usá `vi.fn(async (_input: unknown) => {})` y casteá en la aserción.
- **Sin librerías nuevas.** Todo se hace con lo que ya está en `package.json` (la única excepción autorizada es subir la versión de `@anthropic-ai/sdk`, en la Tarea 1).

---

## Estructura de archivos

### Se crean

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20260801000000_feedback_loop.sql` | 4 tablas, índices, versión 1 semilla de cada prompt, y la función SQL atómica de aplicación. |
| `scripts/check-feedback-schema.ts` | Verifica que la migración quedó aplicada (se usa como test de la Tarea 1). |
| `lib/review-constants.ts` | Constantes compartidas: texto de fallback del bot, umbrales, claves de agente. Sin I/O. |
| `lib/conversation-episodes.ts` | Partir logs en episodios, detectar señales, calcular peso. **Lógica pura.** |
| `lib/review-summary.ts` | Llamada a Claude para el resumen del episodio (salida estructurada). |
| `lib/review-scan.ts` | El barrido: lee logs, arma episodios, resume, inserta. Compartido por cron y botón manual. |
| `lib/reviews.ts` | Persistencia de revisiones: listar, detalle, guardar feedback. |
| `lib/learned-rules.ts` | Reglas: máquina de estados, generación por IA, consolidación en fragmento. |
| `lib/prompt-versions.ts` | Snapshot, aplicación atómica y restauración de versiones del prompt. |
| `app/api/cron/resumenes/route.ts` | Cron del barrido. |
| `app/api/reviews/refresh/route.ts` | Barrido manual desde el panel. |
| `app/api/reviews/[id]/feedback/route.ts` | Guarda calificación + comentarios y genera la regla. |
| `app/api/reviews/[id]/retry-rule/route.ts` | Reintenta solo la generación de la regla. |
| `app/api/rules/[id]/route.ts` | `PATCH`: compuerta 1 (aprobar / editar / rechazar). |
| `app/api/prompts/[agentKey]/prepare/route.ts` | Consolida reglas aprobadas → prompt propuesto (sin guardar). |
| `app/api/prompts/[agentKey]/apply/route.ts` | Compuerta 2: aplica de forma atómica. |
| `app/api/prompts/[agentKey]/restore/route.ts` | Restaura una versión. |
| `app/revision/page.tsx` | Server component: carga inicial de la bandeja. |
| `components/review/ReviewWorkspace.tsx` | Contenedor con pestañas; mantiene el estado compartido. |
| `components/review/ReviewInbox.tsx` | Lista priorizada + filtros + "Actualizar bandeja". |
| `components/review/ReviewDetail.tsx` | Resumen IA / conversación real / calificación y comentario. |
| `components/review/RulesQueue.tsx` | Compuerta 1. |
| `components/review/PromptApply.tsx` | Compuerta 2 + historial de versiones. |

### Se modifican

| Archivo | Cambio |
|---|---|
| `lib/anthropic.ts` | Agregar `ANTHROPIC_REVIEW_MODEL` y `ANTHROPIC_RULES_MODEL`. |
| `app/api/chatbot/route.ts:264-270` | Usar la constante compartida del mensaje de fallback en vez del literal. |
| `components/AppHeader.tsx` | Enlace a `/revision`. |
| `vercel.json` | Cron nuevo. |
| `.env.example` | Variables nuevas. |
| `package.json` | Subir `@anthropic-ai/sdk`. |

---

## Tareas

### Tarea 1: Base de datos, constantes compartidas y configuración de modelos

Deja el esquema aplicado y toda la configuración lista. Sin esto ninguna otra tarea puede correr.

**Files:**
- Create: `supabase/migrations/20260801000000_feedback_loop.sql`
- Create: `scripts/check-feedback-schema.ts`
- Create: `lib/review-constants.ts`
- Modify: `lib/anthropic.ts`
- Modify: `app/api/chatbot/route.ts:264-270`
- Modify: `.env.example`
- Modify: `package.json` (vía `npm install`)

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces:
  - `CHATBOT_FALLBACK_MESSAGE: string`, `REVIEW_IDLE_HOURS: number`, `REVIEW_BATCH_SIZE: number`, `RULE_AGENT_KEYS: readonly ['soporte','bigday','ventas']`, `type RuleAgentKey` — desde `lib/review-constants.ts`.
  - `ANTHROPIC_REVIEW_MODEL: string`, `ANTHROPIC_RULES_MODEL: string` — desde `lib/anthropic.ts`.
  - Tablas `nlcn_conversation_reviews`, `nlcn_message_feedback`, `nlcn_learned_rules`, `nlcn_prompt_versions` y la función `nlcn_apply_prompt_version(...)`.

---

- [ ] **Step 1: Subir el SDK de Anthropic**

La salida estructurada (`output_config.format`) necesita tipos que la 0.99 puede no tener.

```bash
npm install @anthropic-ai/sdk@latest
```

- [ ] **Step 2: Verificar que subir el SDK no rompió nada**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — la suite existente (`lib/ghl-importer.test.ts`, `lib/prospect-*.test.ts`, `app/api/contacts/import/route.test.ts`) sigue en verde y no hay errores de tipos.

Si `tsc` falla en código existente por el cambio de versión, arreglalo ahí mismo antes de seguir; no continúes con la suite roja.

- [ ] **Step 3: Escribir la migración**

Create `supabase/migrations/20260801000000_feedback_loop.sql`:

```sql
-- ════════════════════════════════════════════════════════════════
-- Migración: ciclo de retroalimentación del chatbot.
--
-- Resumen de conversaciones → revisión humana → reglas aprendidas →
-- cambio aprobado al system_prompt, con historial restaurable.
--
-- Idempotente. El service_role (que usan las API routes) bypassa RLS.
-- ════════════════════════════════════════════════════════════════

-- ── Revisiones: una fila por episodio de conversación ───────────
-- Un "episodio" es un bloque de mensajes de un mismo (phone, agente)
-- separado del siguiente por >= REVIEW_IDLE_HOURS de silencio.
CREATE TABLE IF NOT EXISTS nlcn_conversation_reviews (
  id             BIGSERIAL PRIMARY KEY,
  phone          TEXT NOT NULL,
  agente         TEXT NOT NULL,
  contact_id     TEXT,
  window_start   TIMESTAMPTZ NOT NULL,
  window_end     TIMESTAMPTZ NOT NULL,
  turn_count     INTEGER NOT NULL DEFAULT 0,
  summary        TEXT,
  topics         JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome        TEXT,
  risk_score     INTEGER NOT NULL DEFAULT 0,
  signals        JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority       INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pendiente',
  human_rating   TEXT,
  human_comment  TEXT,
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotencia del barrido: el cron puede correr dos veces sobre los
-- mismos datos sin duplicar filas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nlcn_reviews_episodio
  ON nlcn_conversation_reviews (phone, agente, window_end);

CREATE INDEX IF NOT EXISTS idx_nlcn_reviews_bandeja
  ON nlcn_conversation_reviews (status, priority DESC, window_end DESC);

CREATE INDEX IF NOT EXISTS idx_nlcn_reviews_created
  ON nlcn_conversation_reviews (created_at);

-- ── Feedback anclado a una respuesta puntual del bot ─────────────
CREATE TABLE IF NOT EXISTS nlcn_message_feedback (
  id              BIGSERIAL PRIMARY KEY,
  review_id       BIGINT NOT NULL REFERENCES nlcn_conversation_reviews(id) ON DELETE CASCADE,
  chatbot_log_id  BIGINT NOT NULL,
  verdict         TEXT NOT NULL CHECK (verdict IN ('bien', 'mal')),
  comment         TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nlcn_msg_feedback_review
  ON nlcn_message_feedback (review_id);

-- ── Versiones del prompt (historial restaurable) ─────────────────
-- Cada fila guarda el prompt RESULTANTE de esa versión, no el anterior.
CREATE TABLE IF NOT EXISTS nlcn_prompt_versions (
  id              BIGSERIAL PRIMARY KEY,
  agent_key       TEXT NOT NULL,
  version_number  INTEGER NOT NULL,
  system_prompt   TEXT NOT NULL,
  change_summary  TEXT,
  rule_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nlcn_prompt_versions
  ON nlcn_prompt_versions (agent_key, version_number);

-- ── Reglas aprendidas ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nlcn_learned_rules (
  id                 BIGSERIAL PRIMARY KEY,
  agent_key          TEXT NOT NULL,
  source_review_id   BIGINT REFERENCES nlcn_conversation_reviews(id) ON DELETE SET NULL,
  trigger_text       TEXT NOT NULL,
  rule_text          TEXT NOT NULL,
  rationale          TEXT,
  kind               TEXT NOT NULL DEFAULT 'nueva' CHECK (kind IN ('nueva', 'conflicto')),
  conflict_excerpt   TEXT,
  status             TEXT NOT NULL DEFAULT 'propuesta'
                     CHECK (status IN ('propuesta', 'aprobada', 'aplicada', 'rechazada')),
  rejection_reason   TEXT,
  created_by         TEXT,
  reviewed_by        TEXT,
  reviewed_at        TIMESTAMPTZ,
  applied_version_id BIGINT REFERENCES nlcn_prompt_versions(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nlcn_rules_cola
  ON nlcn_learned_rules (status, agent_key, created_at DESC);

-- ── Semilla: versión 1 con el prompt actual de cada agente ───────
-- Garantiza que ningún agente quede sin punto de retorno.
INSERT INTO nlcn_prompt_versions (agent_key, version_number, system_prompt, change_summary, created_by)
SELECT p.agent_key, 1, p.system_prompt, 'Versión inicial (antes del ciclo de feedback)', 'migración'
FROM nlcn_agent_prompts p
WHERE NOT EXISTS (
  SELECT 1 FROM nlcn_prompt_versions v WHERE v.agent_key = p.agent_key
);

-- ── Aplicación atómica del cambio al prompt ──────────────────────
-- Crea la versión nueva, actualiza el prompt vivo y marca las reglas
-- como aplicadas. O pasa todo o no pasa nada: si algo falla, la
-- función aborta y Postgres revierte la transacción completa.
CREATE OR REPLACE FUNCTION nlcn_apply_prompt_version(
  p_agent_key      TEXT,
  p_system_prompt  TEXT,
  p_rule_ids       BIGINT[],
  p_change_summary TEXT,
  p_created_by     TEXT
)
RETURNS TABLE (version_id BIGINT, version_number INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_next    INTEGER;
  v_id      BIGINT;
BEGIN
  -- Bloquea las versiones de este agente para que dos aplicaciones
  -- simultáneas no reclamen el mismo version_number.
  PERFORM 1 FROM nlcn_prompt_versions
    WHERE agent_key = p_agent_key FOR UPDATE;

  SELECT COALESCE(MAX(v.version_number), 0) + 1 INTO v_next
    FROM nlcn_prompt_versions v WHERE v.agent_key = p_agent_key;

  INSERT INTO nlcn_prompt_versions
    (agent_key, version_number, system_prompt, change_summary, rule_ids, created_by)
  VALUES
    (p_agent_key, v_next, p_system_prompt, p_change_summary,
     to_jsonb(COALESCE(p_rule_ids, ARRAY[]::BIGINT[])), p_created_by)
  RETURNING id INTO v_id;

  UPDATE nlcn_agent_prompts
     SET system_prompt = p_system_prompt,
         updated_by    = p_created_by
   WHERE agent_key = p_agent_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el agente %', p_agent_key;
  END IF;

  -- Solo reglas aprobadas pasan a aplicada. Una regla en otro estado
  -- se ignora en silencio: la validación dura vive en la API.
  UPDATE nlcn_learned_rules
     SET status = 'aplicada',
         applied_version_id = v_id
   WHERE id = ANY(COALESCE(p_rule_ids, ARRAY[]::BIGINT[]))
     AND status = 'aprobada';

  RETURN QUERY SELECT v_id, v_next;
END;
$$;
```

- [ ] **Step 4: Escribir el verificador del esquema**

Create `scripts/check-feedback-schema.ts` (mismo patrón de arranque que `scripts/seed-prompts.ts`):

```ts
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const TABLAS = [
  'nlcn_conversation_reviews',
  'nlcn_message_feedback',
  'nlcn_learned_rules',
  'nlcn_prompt_versions',
];

async function main() {
  let ok = true;

  for (const tabla of TABLAS) {
    const { error } = await supabase.from(tabla).select('id', { count: 'exact', head: true });
    if (error) {
      console.error(`✗ ${tabla}: ${error.message}`);
      ok = false;
    } else {
      console.log(`✓ ${tabla}`);
    }
  }

  // Cada agente debe tener su versión 1 semilla.
  const { data: prompts } = await supabase.from('nlcn_agent_prompts').select('agent_key');
  const { data: versiones } = await supabase
    .from('nlcn_prompt_versions')
    .select('agent_key')
    .eq('version_number', 1);
  const conVersion = new Set((versiones ?? []).map((v) => v.agent_key));
  for (const p of prompts ?? []) {
    if (conVersion.has(p.agent_key)) {
      console.log(`✓ versión 1 semilla: ${p.agent_key}`);
    } else {
      console.error(`✗ falta versión 1 para ${p.agent_key}`);
      ok = false;
    }
  }

  // La función atómica debe existir. Se invoca con un agente inexistente:
  // si responde con el error de negocio, la función está instalada.
  const { error: rpcError } = await supabase.rpc('nlcn_apply_prompt_version', {
    p_agent_key: '__inexistente__',
    p_system_prompt: 'x',
    p_rule_ids: [],
    p_change_summary: 'verificación',
    p_created_by: 'check-script',
  });
  if (rpcError && /No existe el agente/.test(rpcError.message)) {
    console.log('✓ nlcn_apply_prompt_version instalada');
  } else if (rpcError) {
    console.error(`✗ nlcn_apply_prompt_version: ${rpcError.message}`);
    ok = false;
  } else {
    console.error('✗ nlcn_apply_prompt_version no validó el agente inexistente');
    ok = false;
  }

  process.exit(ok ? 0 : 1);
}

main();
```

- [ ] **Step 5: Verificar que el esquema todavía NO existe**

Run: `npx tsx scripts/check-feedback-schema.ts`
Expected: FALLA con `✗ nlcn_conversation_reviews: ...` — la migración aún no se aplicó. Este es el "test que falla" de esta tarea.

- [ ] **Step 6: Aplicar la migración**

```bash
npx supabase db push
```

Si el CLI no está enlazado al proyecto, pegá el contenido de `supabase/migrations/20260801000000_feedback_loop.sql` en el editor SQL del panel de Supabase y ejecutalo. Es idempotente: se puede correr más de una vez sin daño.

- [ ] **Step 7: Verificar que el esquema quedó aplicado**

Run: `npx tsx scripts/check-feedback-schema.ts`
Expected: PASS — todas las líneas con `✓`, código de salida 0.

- [ ] **Step 8: Crear las constantes compartidas**

Create `lib/review-constants.ts`:

```ts
/**
 * Constantes del ciclo de retroalimentación. Sin I/O y sin `server-only`:
 * los componentes de cliente también leen las etiquetas de señal.
 */

/**
 * Mensaje que el chatbot envía cuando Claude falla. Vive acá (y no como
 * literal en la ruta) porque la detección de la señal `error_bot` lo compara
 * contra `message_out`: si el texto cambiara en un solo lugar, la señal
 * dejaría de dispararse en silencio.
 */
export const CHATBOT_FALLBACK_MESSAGE =
  '¡Hola! Disculpa, tengo dificultades para procesar tu consulta en este momento. ¿Podrías intentar nuevamente o comunicarte directamente con nuestra recepción?';

/** Silencio (en horas) que cierra un episodio de conversación. */
export const REVIEW_IDLE_HOURS = Number(process.env.REVIEW_IDLE_HOURS ?? 6);

/** Tope de episodios por corrida del barrido (maxDuration = 60s en Vercel). */
export const REVIEW_BATCH_SIZE = Number(process.env.REVIEW_BATCH_SIZE ?? 20);

/** Agentes a los que una regla aprendida puede apuntar. */
export const RULE_AGENT_KEYS = ['soporte', 'bigday', 'ventas'] as const;
export type RuleAgentKey = (typeof RULE_AGENT_KEYS)[number];

export function isRuleAgentKey(value: string): value is RuleAgentKey {
  return (RULE_AGENT_KEYS as readonly string[]).includes(value);
}
```

- [ ] **Step 9: Usar la constante en el chatbot**

Modify `app/api/chatbot/route.ts`. Agregar el import junto a los demás de `@/lib`:

```ts
import { CHATBOT_FALLBACK_MESSAGE } from '@/lib/review-constants';
```

Y reemplazar el bloque de las líneas 264-270:

```ts
  if (!raw) {
    return { mensaje: CHATBOT_FALLBACK_MESSAGE, transferToSales: false };
  }
```

- [ ] **Step 10: Agregar los modelos de revisión**

Modify `lib/anthropic.ts`, agregando al final:

```ts
/**
 * Modelos del ciclo de retroalimentación. Separados de ANTHROPIC_MODEL a
 * propósito: cambiar el modelo de los resúmenes no debe alterar las
 * respuestas que reciben los huéspedes.
 */

/** Resúmenes de conversación: alto volumen, extracción estructurada. */
export const ANTHROPIC_REVIEW_MODEL =
  process.env.ANTHROPIC_REVIEW_MODEL || 'claude-sonnet-5';

/** Reglas y consolidación al prompt: bajo volumen, criterio fino. */
export const ANTHROPIC_RULES_MODEL =
  process.env.ANTHROPIC_RULES_MODEL || 'claude-opus-5';
```

- [ ] **Step 11: Documentar las variables de entorno**

Modify `.env.example`, agregando después del bloque de Anthropic:

```
# Ciclo de retroalimentación: modelos separados del chatbot
ANTHROPIC_REVIEW_MODEL=claude-sonnet-5
ANTHROPIC_RULES_MODEL=claude-opus-5

# Ciclo de retroalimentación: horas de silencio que cierran un episodio
REVIEW_IDLE_HOURS=6
# Ciclo de retroalimentación: episodios resumidos por corrida del barrido
REVIEW_BATCH_SIZE=20
```

- [ ] **Step 12: Verificar que todo compila y la suite sigue verde**

Run: `npx tsc --noEmit && npm test`
Expected: PASS, sin errores de tipos y con la suite existente en verde.

- [ ] **Step 13: Commit**

```bash
git add supabase/migrations/20260801000000_feedback_loop.sql \
        scripts/check-feedback-schema.ts \
        lib/review-constants.ts lib/anthropic.ts \
        app/api/chatbot/route.ts .env.example \
        package.json package-lock.json
git commit -m "feat(revision): esquema del ciclo de feedback y configuración de modelos"
```

---

### Tarea 2: Episodios y señales (lógica pura)

El corazón del sistema y lo único puramente algorítmico. Se prueba a fondo porque todo lo demás depende de que agrupe bien.

**Files:**
- Create: `lib/conversation-episodes.ts`
- Test: `lib/conversation-episodes.test.ts`

**Interfaces:**
- Consumes: `CHATBOT_FALLBACK_MESSAGE`, `REVIEW_IDLE_HOURS` de `lib/review-constants.ts`.
- Produces:
  - `type ChatbotLog = { id: number; phone: string; contact_id: string | null; message_in: string | null; message_out: string | null; has_reservation: boolean | null; agente_usado: string | null; transferir_a_ventas: boolean | null; created_at: string }`
  - `type Signal = 'escalamiento' | 'error_bot' | 'no_procesable' | 'derivado_ventas' | 'conversacion_larga'`
  - `type Episode = { phone: string; agente: string; contact_id: string | null; window_start: string; window_end: string; turn_count: number; logs: ChatbotLog[]; signals: Signal[]; signal_weight: number }`
  - `SIGNAL_WEIGHTS: Record<Signal, number>`
  - `SIGNAL_LABELS: Record<Signal, string>`
  - `splitIntoEpisodes(logs: ChatbotLog[], idleHours?: number): Episode[]`
  - `detectSignals(logs: ChatbotLog[]): Signal[]`
  - `signalWeight(signals: Signal[]): number`

---

- [ ] **Step 1: Escribir los tests que fallan**

Create `lib/conversation-episodes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CHATBOT_FALLBACK_MESSAGE } from '@/lib/review-constants';
import {
  splitIntoEpisodes,
  detectSignals,
  signalWeight,
  type ChatbotLog,
} from './conversation-episodes';

/** Construye un log con valores por defecto sanos. */
function log(partial: Partial<ChatbotLog> & { id: number; created_at: string }): ChatbotLog {
  return {
    phone: '+50688887777',
    contact_id: 'c1',
    message_in: 'hola',
    message_out: 'buenas',
    has_reservation: false,
    agente_usado: 'soporte',
    transferir_a_ventas: false,
    ...partial,
  };
}

describe('splitIntoEpisodes', () => {
  it('mensajes seguidos forman un solo episodio', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T10:05:00Z' }),
      log({ id: 3, created_at: '2026-07-01T10:20:00Z' }),
    ]);

    expect(eps).toHaveLength(1);
    expect(eps[0].turn_count).toBe(3);
    expect(eps[0].window_start).toBe('2026-07-01T10:00:00Z');
    expect(eps[0].window_end).toBe('2026-07-01T10:20:00Z');
  });

  it('un hueco de 7 horas parte la conversación en dos episodios', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T17:00:00Z' }),
    ]);

    expect(eps).toHaveLength(2);
    expect(eps[0].turn_count).toBe(1);
    expect(eps[1].turn_count).toBe(1);
  });

  it('un hueco de exactamente 6 horas ya cierra el episodio', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T16:00:00Z' }),
    ]);

    expect(eps).toHaveLength(2);
  });

  it('un hueco de 5h59m NO cierra el episodio', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T15:59:00Z' }),
    ]);

    expect(eps).toHaveLength(1);
  });

  it('una conversación de un solo mensaje es un episodio válido', () => {
    const eps = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    expect(eps).toHaveLength(1);
    expect(eps[0].turn_count).toBe(1);
    expect(eps[0].window_start).toBe(eps[0].window_end);
  });

  it('dos agentes con el mismo teléfono producen episodios separados', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: 'soporte' }),
      log({ id: 2, created_at: '2026-07-01T10:02:00Z', agente_usado: 'ventas' }),
    ]);

    expect(eps).toHaveLength(2);
    expect(eps.map((e) => e.agente).sort()).toEqual(['soporte', 'ventas']);
  });

  it('dos teléfonos distintos producen episodios separados', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', phone: '+50611111111' }),
      log({ id: 2, created_at: '2026-07-01T10:02:00Z', phone: '+50622222222' }),
    ]);

    expect(eps).toHaveLength(2);
  });

  it('ordena logs desordenados antes de agrupar', () => {
    const eps = splitIntoEpisodes([
      log({ id: 3, created_at: '2026-07-01T10:20:00Z' }),
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T10:05:00Z' }),
    ]);

    expect(eps).toHaveLength(1);
    expect(eps[0].logs.map((l) => l.id)).toEqual([1, 2, 3]);
  });

  it('un agente nulo se agrupa como "desconocido" sin perder el log', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: null }),
    ]);

    expect(eps).toHaveLength(1);
    expect(eps[0].agente).toBe('desconocido');
  });

  it('respeta un umbral de horas personalizado', () => {
    const logs = [
      log({ id: 1, created_at: '2026-07-01T10:00:00Z' }),
      log({ id: 2, created_at: '2026-07-01T12:00:00Z' }),
    ];

    expect(splitIntoEpisodes(logs, 6)).toHaveLength(1);
    expect(splitIntoEpisodes(logs, 1)).toHaveLength(2);
  });

  it('una lista vacía devuelve una lista vacía', () => {
    expect(splitIntoEpisodes([])).toEqual([]);
  });
});

describe('detectSignals', () => {
  it('detecta escalamiento a humano', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: 'escalamiento' }),
    ]);
    expect(señales).toContain('escalamiento');
  });

  it('detecta el mensaje de error del bot por la constante compartida', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', message_out: CHATBOT_FALLBACK_MESSAGE }),
    ]);
    expect(señales).toContain('error_bot');
  });

  it('detecta mensaje no procesable', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: 'sistema' }),
    ]);
    expect(señales).toContain('no_procesable');
  });

  it('detecta derivación a ventas', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', transferir_a_ventas: true }),
    ]);
    expect(señales).toContain('derivado_ventas');
  });

  it('marca conversación larga a partir de 8 turnos', () => {
    const ocho = Array.from({ length: 8 }, (_, i) =>
      log({ id: i + 1, created_at: `2026-07-01T10:0${i}:00Z` }),
    );
    expect(detectSignals(ocho)).toContain('conversacion_larga');

    const siete = ocho.slice(0, 7);
    expect(detectSignals(siete)).not.toContain('conversacion_larga');
  });

  it('una conversación normal no dispara ninguna señal', () => {
    expect(detectSignals([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })])).toEqual([]);
  });

  it('no repite una señal que aparece en varios turnos', () => {
    const señales = detectSignals([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', transferir_a_ventas: true }),
      log({ id: 2, created_at: '2026-07-01T10:01:00Z', transferir_a_ventas: true }),
    ]);
    expect(señales.filter((s) => s === 'derivado_ventas')).toHaveLength(1);
  });
});

describe('signalWeight', () => {
  it('suma los pesos de las señales', () => {
    // escalamiento (40) + derivado_ventas (20)
    expect(signalWeight(['escalamiento', 'derivado_ventas'])).toBe(60);
  });

  it('sin señales el peso es cero', () => {
    expect(signalWeight([])).toBe(0);
  });
});

describe('integración: el episodio trae sus señales calculadas', () => {
  it('adjunta señales y peso a cada episodio', () => {
    const eps = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', agente_usado: 'escalamiento' }),
    ]);

    expect(eps[0].signals).toEqual(['escalamiento']);
    expect(eps[0].signal_weight).toBe(40);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/conversation-episodes.test.ts`
Expected: FAIL — `Failed to resolve import "./conversation-episodes"`.

- [ ] **Step 3: Implementar el módulo**

Create `lib/conversation-episodes.ts`:

```ts
import { CHATBOT_FALLBACK_MESSAGE, REVIEW_IDLE_HOURS } from '@/lib/review-constants';

/**
 * Agrupa los turnos de `chatbot_logs` en episodios de conversación y detecta
 * las señales heurísticas que ordenan la bandeja de revisión.
 *
 * Todo acá es lógica pura: sin Supabase, sin IA, sin reloj. Eso lo hace
 * barato de probar y determinístico, que es justo lo que necesita la
 * idempotencia del barrido.
 */

export type ChatbotLog = {
  id: number;
  phone: string;
  contact_id: string | null;
  message_in: string | null;
  message_out: string | null;
  has_reservation: boolean | null;
  agente_usado: string | null;
  transferir_a_ventas: boolean | null;
  created_at: string;
};

export type Signal =
  | 'escalamiento'
  | 'error_bot'
  | 'no_procesable'
  | 'derivado_ventas'
  | 'conversacion_larga';

export type Episode = {
  phone: string;
  agente: string;
  contact_id: string | null;
  window_start: string;
  window_end: string;
  turn_count: number;
  logs: ChatbotLog[];
  signals: Signal[];
  signal_weight: number;
};

export const SIGNAL_WEIGHTS: Record<Signal, number> = {
  escalamiento: 40,
  error_bot: 40,
  no_procesable: 25,
  derivado_ventas: 20,
  conversacion_larga: 15,
};

/** Etiquetas para los chips de la bandeja. */
export const SIGNAL_LABELS: Record<Signal, string> = {
  escalamiento: 'Escaló a humano',
  error_bot: 'El bot dio error',
  no_procesable: 'No pudo procesar',
  derivado_ventas: 'Derivado a ventas',
  conversacion_larga: 'Conversación larga',
};

const TURNOS_CONVERSACION_LARGA = 8;
const AGENTE_DESCONOCIDO = 'desconocido';

export function detectSignals(logs: ChatbotLog[]): Signal[] {
  const señales = new Set<Signal>();

  for (const l of logs) {
    if (l.agente_usado === 'escalamiento') señales.add('escalamiento');
    if (l.agente_usado === 'sistema') señales.add('no_procesable');
    if (l.transferir_a_ventas === true) señales.add('derivado_ventas');
    if ((l.message_out ?? '').trim() === CHATBOT_FALLBACK_MESSAGE) señales.add('error_bot');
  }

  if (logs.length >= TURNOS_CONVERSACION_LARGA) señales.add('conversacion_larga');

  return [...señales];
}

export function signalWeight(signals: Signal[]): number {
  return signals.reduce((total, s) => total + (SIGNAL_WEIGHTS[s] ?? 0), 0);
}

/**
 * Parte los logs en episodios. Agrupa por (teléfono, agente) y corta cada vez
 * que el silencio entre dos turnos llega o supera `idleHours`.
 */
export function splitIntoEpisodes(
  logs: ChatbotLog[],
  idleHours: number = REVIEW_IDLE_HOURS,
): Episode[] {
  const huecoMs = idleHours * 60 * 60 * 1000;

  // Agrupar por conversación. Un agente nulo entra como "desconocido" en vez
  // de descartarse: si el bot falló antes de rutear, el episodio igual importa.
  const porConversacion = new Map<string, ChatbotLog[]>();
  for (const l of logs) {
    const agente = l.agente_usado || AGENTE_DESCONOCIDO;
    const clave = `${l.phone} ${agente}`;
    const grupo = porConversacion.get(clave);
    if (grupo) grupo.push(l);
    else porConversacion.set(clave, [l]);
  }

  const episodios: Episode[] = [];

  for (const [clave, grupo] of porConversacion) {
    const [phone, agente] = clave.split(' ');
    const ordenados = [...grupo].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );

    let bloque: ChatbotLog[] = [];
    for (const l of ordenados) {
      const anterior = bloque[bloque.length - 1];
      const hayCorte =
        anterior !== undefined &&
        Date.parse(l.created_at) - Date.parse(anterior.created_at) >= huecoMs;

      if (hayCorte) {
        episodios.push(construirEpisodio(phone, agente, bloque));
        bloque = [];
      }
      bloque.push(l);
    }
    if (bloque.length > 0) episodios.push(construirEpisodio(phone, agente, bloque));
  }

  return episodios;
}

function construirEpisodio(phone: string, agente: string, logs: ChatbotLog[]): Episode {
  const signals = detectSignals(logs);
  return {
    phone,
    agente,
    // El contact_id más reciente del bloque: es el que sigue vigente en GHL.
    contact_id: [...logs].reverse().find((l) => l.contact_id)?.contact_id ?? null,
    window_start: logs[0].created_at,
    window_end: logs[logs.length - 1].created_at,
    turn_count: logs.length,
    logs,
    signals,
    signal_weight: signalWeight(signals),
  };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/conversation-episodes.test.ts`
Expected: PASS — los 21 tests en verde.

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/conversation-episodes.ts lib/conversation-episodes.test.ts
git commit -m "feat(revision): detección de episodios y señales de prioridad"
```

---

### Tarea 3: Resumen del episodio con Claude

**Files:**
- Create: `lib/review-summary.ts`
- Test: `lib/review-summary.test.ts`

**Interfaces:**
- Consumes: `Episode`, `ChatbotLog` de `lib/conversation-episodes.ts`; `anthropic`, `ANTHROPIC_REVIEW_MODEL` de `lib/anthropic.ts`.
- Produces:
  - `type Outcome = 'resuelto' | 'sin_resolver' | 'escalado' | 'derivado_ventas' | 'indeterminado'`
  - `type ReviewSummary = { summary: string; topics: string[]; outcome: Outcome; risk_score: number }`
  - `buildTranscript(logs: ChatbotLog[]): string`
  - `summarizeEpisode(episode: Episode): Promise<ReviewSummary>`

---

- [ ] **Step 1: Escribir los tests que fallan**

Create `lib/review-summary.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create } },
  ANTHROPIC_REVIEW_MODEL: 'claude-sonnet-5',
}));

import { splitIntoEpisodes, type ChatbotLog } from './conversation-episodes';
import { buildTranscript, summarizeEpisode } from './review-summary';

function log(partial: Partial<ChatbotLog> & { id: number; created_at: string }): ChatbotLog {
  return {
    phone: '+50688887777',
    contact_id: 'c1',
    message_in: 'hola',
    message_out: 'buenas',
    has_reservation: false,
    agente_usado: 'soporte',
    transferir_a_ventas: false,
    ...partial,
  };
}

function respuesta(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

const PAYLOAD_OK = {
  summary: 'El huésped preguntó por el check-in.',
  topics: ['check-in'],
  outcome: 'resuelto',
  risk_score: 10,
};

beforeEach(() => {
  create.mockReset();
});

describe('buildTranscript', () => {
  it('numera los turnos y marca quién habló', () => {
    const t = buildTranscript([
      log({ id: 7, created_at: '2026-07-01T10:00:00Z', message_in: '¿a qué hora es el check-in?', message_out: 'A las 2 p.m.' }),
    ]);

    expect(t).toContain('[turno 1 · log 7]');
    expect(t).toContain('Huésped: ¿a qué hora es el check-in?');
    expect(t).toContain('Bot: A las 2 p.m.');
  });

  it('omite las líneas vacías en vez de escribir "null"', () => {
    const t = buildTranscript([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', message_in: '', message_out: 'solo bot' }),
    ]);

    expect(t).not.toContain('Huésped:');
    expect(t).toContain('Bot: solo bot');
  });
});

describe('summarizeEpisode', () => {
  it('devuelve el resumen estructurado', async () => {
    create.mockResolvedValue(respuesta(PAYLOAD_OK));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    const res = await summarizeEpisode(ep);

    expect(res.summary).toBe('El huésped preguntó por el check-in.');
    expect(res.topics).toEqual(['check-in']);
    expect(res.outcome).toBe('resuelto');
    expect(res.risk_score).toBe(10);
  });

  it('usa el modelo de revisión y pide salida estructurada', async () => {
    create.mockResolvedValue(respuesta(PAYLOAD_OK));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    await summarizeEpisode(ep);

    const args = create.mock.calls[0][0];
    expect(args.model).toBe('claude-sonnet-5');
    expect(args.output_config.format.type).toBe('json_schema');
    expect(args.output_config.effort).toBe('low');
  });

  it('incluye el transcript y las señales detectadas en el prompt', async () => {
    create.mockResolvedValue(respuesta(PAYLOAD_OK));
    const [ep] = splitIntoEpisodes([
      log({ id: 1, created_at: '2026-07-01T10:00:00Z', message_in: 'quiero cancelar', agente_usado: 'escalamiento' }),
    ]);

    await summarizeEpisode(ep);

    const contenido = create.mock.calls[0][0].messages[0].content as string;
    expect(contenido).toContain('quiero cancelar');
    expect(contenido).toContain('escalamiento');
  });

  it('acota risk_score al rango 0-100 aunque el modelo se pase', async () => {
    create.mockResolvedValue(respuesta({ ...PAYLOAD_OK, risk_score: 950 }));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    expect((await summarizeEpisode(ep)).risk_score).toBe(100);
  });

  it('cae a "indeterminado" si el outcome no es uno de los válidos', async () => {
    create.mockResolvedValue(respuesta({ ...PAYLOAD_OK, outcome: 'cualquier-cosa' }));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    expect((await summarizeEpisode(ep)).outcome).toBe('indeterminado');
  });

  it('propaga el error si Claude falla — el barrido decide qué hacer', async () => {
    create.mockRejectedValue(new Error('529 overloaded'));
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    await expect(summarizeEpisode(ep)).rejects.toThrow('529 overloaded');
  });

  it('lanza si la respuesta no trae bloque de texto', async () => {
    create.mockResolvedValue({ content: [] });
    const [ep] = splitIntoEpisodes([log({ id: 1, created_at: '2026-07-01T10:00:00Z' })]);

    await expect(summarizeEpisode(ep)).rejects.toThrow(/respuesta vacía/i);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/review-summary.test.ts`
Expected: FAIL — `Failed to resolve import "./review-summary"`.

- [ ] **Step 3: Implementar el módulo**

Create `lib/review-summary.ts`:

```ts
import 'server-only';
import { anthropic, ANTHROPIC_REVIEW_MODEL } from '@/lib/anthropic';
import { SIGNAL_LABELS, type ChatbotLog, type Episode } from '@/lib/conversation-episodes';

/**
 * Resume un episodio de conversación con Claude.
 *
 * Usa salida estructurada (`output_config.format`): la API garantiza la forma
 * del JSON, así que no hay que defenderse de respuestas a medio formatear.
 * Igual se validan los valores (rango, enum) porque el esquema garantiza la
 * forma, no que el modelo elija bien.
 */

export const OUTCOMES = [
  'resuelto',
  'sin_resolver',
  'escalado',
  'derivado_ventas',
  'indeterminado',
] as const;

export type Outcome = (typeof OUTCOMES)[number];

export type ReviewSummary = {
  summary: string;
  topics: string[];
  outcome: Outcome;
  risk_score: number;
};

const SYSTEM = `Sos un analista de calidad de un lodge en Costa Rica (Natural Lodge Caño Negro). Recibís la conversación entre un huésped y el chatbot del hotel, y devolvés una ficha de revisión para que el equipo — gente NO técnica — entienda de un vistazo qué pasó.

Reglas:
- El resumen va en español neutro, en 1 a 3 oraciones. Contá qué pidió el huésped, qué hizo el bot y en qué terminó.
- Escribí para alguien que no leyó la conversación. Nada de jerga ni de referencias a "el turno 3".
- Los temas son etiquetas cortas en minúscula (ej. "check-in", "traslados", "precios"). Entre 1 y 5.
- El desenlace es uno de: resuelto, sin_resolver, escalado, derivado_ventas, indeterminado.
- risk_score es 0-100: qué tan urgente es que una persona revise esta conversación. Alto si el bot dio información dudosa, dejó al huésped sin respuesta, o se perdió una venta. Bajo si fue una consulta simple bien resuelta.
- No inventes datos que no estén en la conversación.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    topics: { type: 'array', items: { type: 'string' } },
    outcome: { type: 'string', enum: [...OUTCOMES] },
    risk_score: { type: 'integer' },
  },
  required: ['summary', 'topics', 'outcome', 'risk_score'],
  additionalProperties: false,
} as const;

/** Arma el transcript legible del episodio. Exportado para poder probarlo. */
export function buildTranscript(logs: ChatbotLog[]): string {
  return logs
    .map((l, i) => {
      const lineas = [`[turno ${i + 1} · log ${l.id}]`];
      if (l.message_in?.trim()) lineas.push(`Huésped: ${l.message_in.trim()}`);
      if (l.message_out?.trim()) lineas.push(`Bot: ${l.message_out.trim()}`);
      return lineas.join('\n');
    })
    .join('\n\n');
}

export async function summarizeEpisode(episode: Episode): Promise<ReviewSummary> {
  const señales = episode.signals.length
    ? episode.signals.map((s) => `${s} (${SIGNAL_LABELS[s]})`).join(', ')
    : 'ninguna';

  const contenido = [
    `Agente que atendió: ${episode.agente}`,
    `Turnos: ${episode.turn_count}`,
    `El huésped tenía reserva activa: ${episode.logs.some((l) => l.has_reservation) ? 'sí' : 'no'}`,
    `Señales automáticas detectadas: ${señales}`,
    '',
    '=== CONVERSACIÓN ===',
    buildTranscript(episode.logs),
    '=== FIN CONVERSACIÓN ===',
  ].join('\n');

  const res = await anthropic.messages.create({
    model: ANTHROPIC_REVIEW_MODEL,
    max_tokens: 8192,
    system: SYSTEM,
    // Extracción estructurada sobre un texto corto: no necesita razonamiento
    // profundo, y el esfuerzo bajo recorta costo y latencia del alto volumen.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: contenido }],
  } as Parameters<typeof anthropic.messages.create>[0]);

  const bloque = res.content.find((b) => b.type === 'text');
  if (!bloque || bloque.type !== 'text') {
    throw new Error('El modelo devolvió una respuesta vacía al resumir el episodio');
  }

  const bruto = JSON.parse(bloque.text) as ReviewSummary;

  return {
    summary: String(bruto.summary ?? '').trim(),
    topics: Array.isArray(bruto.topics) ? bruto.topics.map(String).slice(0, 5) : [],
    outcome: (OUTCOMES as readonly string[]).includes(bruto.outcome)
      ? bruto.outcome
      : 'indeterminado',
    risk_score: Math.max(0, Math.min(100, Math.round(Number(bruto.risk_score) || 0))),
  };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/review-summary.test.ts`
Expected: PASS — los 9 tests en verde.

- [ ] **Step 5: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/review-summary.ts lib/review-summary.test.ts
git commit -m "feat(revision): resumen de episodios con salida estructurada"
```

---

### Tarea 4: El barrido (scan)

Lee `chatbot_logs`, arma episodios, descarta los ya resumidos, resume y guarda. Es el motor que comparten el cron y el botón manual.

**Files:**
- Create: `lib/review-scan.ts`
- Test: `lib/review-scan.test.ts`

**Interfaces:**
- Consumes: `splitIntoEpisodes`, `type Episode` de `lib/conversation-episodes.ts`; `summarizeEpisode` de `lib/review-summary.ts`; `REVIEW_IDLE_HOURS`, `REVIEW_BATCH_SIZE` de `lib/review-constants.ts`; `createAdminClient` de `lib/supabase/admin.ts`; `logWorkflowError` de `lib/error-log.ts`.
- Produces:
  - `type ScanResult = { candidatos: number; creados: number; fallidos: number }`
  - `scanAndSummarize(opts?: { idleHours?: number; batchSize?: number; now?: Date }): Promise<ScanResult>`

---

- [ ] **Step 1: Escribir los tests que fallan**

Create `lib/review-scan.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const summarizeEpisode = vi.fn();
vi.mock('@/lib/review-summary', () => ({ summarizeEpisode }));

const logWorkflowError = vi.fn(async () => {});
vi.mock('@/lib/error-log', () => ({ logWorkflowError }));

/**
 * Doble de Supabase mínimo: solo las cadenas que usa review-scan.
 * `logsData` alimenta el select de chatbot_logs; `existentes` las claves
 * (phone|agente|window_end) que ya tienen revisión; `insertados` recoge lo
 * que la función intenta guardar.
 */
let logsData: unknown[] = [];
let existentes: { phone: string; agente: string; window_end: string }[] = [];
let insertados: Record<string, unknown>[] = [];
let insertFalla = false;

const createAdminClient = vi.fn(() => ({
  from(tabla: string) {
    if (tabla === 'chatbot_logs') {
      return {
        select: () => ({ lte: () => ({ gte: () => ({ order: async () => ({ data: logsData, error: null }) }) }) }),
      };
    }
    if (tabla === 'nlcn_conversation_reviews') {
      return {
        select: () => ({ gte: async () => ({ data: existentes, error: null }) }),
        insert: async (fila: Record<string, unknown>) => {
          if (insertFalla) return { error: { message: 'insert falló' } };
          insertados.push(fila);
          return { error: null };
        },
      };
    }
    throw new Error(`tabla inesperada: ${tabla}`);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));

import { scanAndSummarize } from './review-scan';

const RESUMEN = { summary: 'resumen', topics: ['t'], outcome: 'resuelto', risk_score: 10 };

function log(id: number, created_at: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    phone: '+50688887777',
    contact_id: 'c1',
    message_in: 'hola',
    message_out: 'buenas',
    has_reservation: false,
    agente_usado: 'soporte',
    transferir_a_ventas: false,
    created_at,
    ...extra,
  };
}

beforeEach(() => {
  logsData = [];
  existentes = [];
  insertados = [];
  insertFalla = false;
  summarizeEpisode.mockReset();
  summarizeEpisode.mockResolvedValue(RESUMEN);
  logWorkflowError.mockClear();
});

describe('scanAndSummarize', () => {
  it('resume y guarda un episodio pendiente', async () => {
    logsData = [log(1, '2026-07-01T10:00:00Z'), log(2, '2026-07-01T10:05:00Z')];

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res).toEqual({ candidatos: 1, creados: 1, fallidos: 0 });
    expect(insertados).toHaveLength(1);
    expect(insertados[0].phone).toBe('+50688887777');
    expect(insertados[0].turn_count).toBe(2);
    expect(insertados[0].summary).toBe('resumen');
    expect(insertados[0].status).toBe('pendiente');
  });

  it('la prioridad suma el peso de las señales y el risk_score', async () => {
    logsData = [log(1, '2026-07-01T10:00:00Z', { agente_usado: 'escalamiento' })];
    summarizeEpisode.mockResolvedValue({ ...RESUMEN, risk_score: 30 });

    await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    // escalamiento (40) + risk_score (30)
    expect(insertados[0].priority).toBe(70);
  });

  it('salta los episodios que ya tienen revisión (idempotencia)', async () => {
    logsData = [log(1, '2026-07-01T10:00:00Z')];
    existentes = [{ phone: '+50688887777', agente: 'soporte', window_end: '2026-07-01T10:00:00Z' }];

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res).toEqual({ candidatos: 0, creados: 0, fallidos: 0 });
    expect(summarizeEpisode).not.toHaveBeenCalled();
  });

  it('compara la ventana por instante, no por el string exacto', async () => {
    logsData = [log(1, '2026-07-01T10:00:00Z')];
    // Postgres devuelve el timestamptz con otro formato que el log original.
    existentes = [{ phone: '+50688887777', agente: 'soporte', window_end: '2026-07-01T10:00:00+00:00' }];

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res.candidatos).toBe(0);
  });

  it('ignora episodios cuya última actividad es demasiado reciente', async () => {
    logsData = [log(1, '2026-07-01T23:00:00Z')];

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res.candidatos).toBe(0);
    expect(summarizeEpisode).not.toHaveBeenCalled();
  });

  it('respeta el tope de episodios por corrida', async () => {
    // Tres conversaciones distintas, todas cerradas.
    logsData = [
      log(1, '2026-07-01T10:00:00Z', { phone: '+1' }),
      log(2, '2026-07-01T10:00:00Z', { phone: '+2' }),
      log(3, '2026-07-01T10:00:00Z', { phone: '+3' }),
    ];

    const res = await scanAndSummarize({ batchSize: 2, now: new Date('2026-07-02T00:00:00Z') });

    expect(res.candidatos).toBe(3);
    expect(res.creados).toBe(2);
    expect(insertados).toHaveLength(2);
  });

  it('prioriza los episodios con más señales cuando hay tope', async () => {
    logsData = [
      log(1, '2026-07-01T10:00:00Z', { phone: '+1' }),
      log(2, '2026-07-01T10:00:00Z', { phone: '+2', agente_usado: 'escalamiento' }),
    ];

    await scanAndSummarize({ batchSize: 1, now: new Date('2026-07-02T00:00:00Z') });

    expect(insertados[0].phone).toBe('+2');
  });

  it('un episodio que falla no detiene a los demás', async () => {
    logsData = [
      log(1, '2026-07-01T10:00:00Z', { phone: '+1' }),
      log(2, '2026-07-01T10:00:00Z', { phone: '+2' }),
    ];
    summarizeEpisode
      .mockRejectedValueOnce(new Error('529 overloaded'))
      .mockResolvedValueOnce(RESUMEN);

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res.creados).toBe(1);
    expect(res.fallidos).toBe(1);
    expect(logWorkflowError).toHaveBeenCalledTimes(1);
  });

  it('un insert fallido cuenta como fallido y se registra', async () => {
    logsData = [log(1, '2026-07-01T10:00:00Z')];
    insertFalla = true;

    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res).toEqual({ candidatos: 1, creados: 0, fallidos: 1 });
    expect(logWorkflowError).toHaveBeenCalledTimes(1);
  });

  it('sin logs no hace nada', async () => {
    const res = await scanAndSummarize({ now: new Date('2026-07-02T00:00:00Z') });

    expect(res).toEqual({ candidatos: 0, creados: 0, fallidos: 0 });
    expect(summarizeEpisode).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/review-scan.test.ts`
Expected: FAIL — `Failed to resolve import "./review-scan"`.

- [ ] **Step 3: Implementar el barrido**

Create `lib/review-scan.ts`:

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logWorkflowError } from '@/lib/error-log';
import { REVIEW_BATCH_SIZE, REVIEW_IDLE_HOURS } from '@/lib/review-constants';
import { splitIntoEpisodes, type ChatbotLog, type Episode } from '@/lib/conversation-episodes';
import { summarizeEpisode } from '@/lib/review-summary';

/**
 * Barrido: encuentra episodios cerrados y sin resumir, los resume y los
 * guarda. Lo usan el cron y el botón "Actualizar bandeja" del panel.
 *
 * Es seguro correrlo dos veces: el índice único (phone, agente, window_end)
 * y el filtro de episodios ya existentes evitan duplicados.
 */

const WORKFLOW = 'revision_resumenes';

/** Ventana de logs que se mira hacia atrás. Más allá de eso ya no interesa. */
const DIAS_HACIA_ATRAS = 30;

export type ScanResult = {
  /** Episodios cerrados y sin revisión encontrados. */
  candidatos: number;
  /** Revisiones efectivamente insertadas en esta corrida. */
  creados: number;
  /** Episodios que fallaron al resumir o al guardar. */
  fallidos: number;
};

export async function scanAndSummarize(opts?: {
  idleHours?: number;
  batchSize?: number;
  now?: Date;
}): Promise<ScanResult> {
  const idleHours = opts?.idleHours ?? REVIEW_IDLE_HOURS;
  const batchSize = opts?.batchSize ?? REVIEW_BATCH_SIZE;
  const ahora = opts?.now ?? new Date();

  const supabase = createAdminClient();

  // Solo mensajes con al menos `idleHours` de antigüedad: los más nuevos
  // pueden pertenecer a una conversación todavía viva.
  const corte = new Date(ahora.getTime() - idleHours * 60 * 60 * 1000).toISOString();
  const desde = new Date(ahora.getTime() - DIAS_HACIA_ATRAS * 24 * 60 * 60 * 1000).toISOString();

  const { data: logs, error } = await supabase
    .from('chatbot_logs')
    .select(
      'id, phone, contact_id, message_in, message_out, has_reservation, agente_usado, transferir_a_ventas, created_at',
    )
    .lte('created_at', corte)
    .gte('created_at', desde)
    .order('created_at', { ascending: true });

  if (error) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'leer_logs', error });
    return { candidatos: 0, creados: 0, fallidos: 0 };
  }

  const episodios = splitIntoEpisodes((logs ?? []) as ChatbotLog[], idleHours);

  // Revisiones ya existentes en la misma ventana temporal.
  const { data: yaRevisados } = await supabase
    .from('nlcn_conversation_reviews')
    .select('phone, agente, window_end')
    .gte('window_end', desde);

  const vistos = new Set(
    (yaRevisados ?? []).map((r) => claveEpisodio(r.phone, r.agente, r.window_end)),
  );

  const pendientes = episodios.filter(
    (ep) => !vistos.has(claveEpisodio(ep.phone, ep.agente, ep.window_end)),
  );

  // Con tope, primero los que más pinta tienen de tener un problema.
  const lote = [...pendientes]
    .sort((a, b) => b.signal_weight - a.signal_weight)
    .slice(0, batchSize);

  let creados = 0;
  let fallidos = 0;

  for (const ep of lote) {
    try {
      const resumen = await summarizeEpisode(ep);

      const { error: insertError } = await supabase.from('nlcn_conversation_reviews').insert({
        phone: ep.phone,
        agente: ep.agente,
        contact_id: ep.contact_id,
        window_start: ep.window_start,
        window_end: ep.window_end,
        turn_count: ep.turn_count,
        summary: resumen.summary,
        topics: resumen.topics,
        outcome: resumen.outcome,
        risk_score: resumen.risk_score,
        signals: ep.signals,
        priority: ep.signal_weight + resumen.risk_score,
        status: 'pendiente',
      });

      if (insertError) throw new Error(insertError.message);
      creados++;
    } catch (err) {
      fallidos++;
      // Se registra y se sigue: un episodio roto no puede bloquear al resto.
      // El índice único garantiza que se reintente en la próxima corrida.
      await logWorkflowError({
        workflow: WORKFLOW,
        node: 'resumir_episodio',
        error: err,
        context: { phone: ep.phone, agente: ep.agente, window_end: ep.window_end },
      });
    }
  }

  return { candidatos: pendientes.length, creados, fallidos };
}

/**
 * Clave de identidad de un episodio. `window_end` se normaliza a epoch porque
 * Postgres devuelve el timestamptz con otro formato que el string original.
 */
function claveEpisodio(phone: string, agente: string, windowEnd: string): string {
  return `${phone}|${agente}|${Date.parse(windowEnd)}`;
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/review-scan.test.ts`
Expected: PASS — los 10 tests en verde.

- [ ] **Step 5: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/review-scan.ts lib/review-scan.test.ts
git commit -m "feat(revision): barrido idempotente de episodios pendientes"
```

---

### Tarea 5: Rutas del barrido (cron y manual)

**Files:**
- Create: `app/api/cron/resumenes/route.ts`
- Create: `app/api/reviews/refresh/route.ts`
- Test: `app/api/cron/resumenes/route.test.ts`
- Test: `app/api/reviews/refresh/route.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `scanAndSummarize`, `type ScanResult` de `lib/review-scan.ts`; `requireUser` de `lib/api-auth.ts`.
- Produces: `GET /api/cron/resumenes` y `POST /api/reviews/refresh`, ambos devolviendo `{ ok: true, candidatos, creados, fallidos }`.

---

- [ ] **Step 1: Escribir el test del cron**

Create `app/api/cron/resumenes/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const scanAndSummarize = vi.fn();
vi.mock('@/lib/review-scan', () => ({ scanAndSummarize }));

const logWorkflowError = vi.fn(async () => {});
vi.mock('@/lib/error-log', () => ({ logWorkflowError }));

const RESULTADO = { candidatos: 3, creados: 3, fallidos: 0 };

function req(auth?: string): Request {
  return new Request('http://t/api/cron/resumenes', {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  scanAndSummarize.mockReset();
  scanAndSummarize.mockResolvedValue(RESULTADO);
  logWorkflowError.mockClear();
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('GET /api/cron/resumenes', () => {
  it('corre el barrido y devuelve el conteo', async () => {
    const { GET } = await import('./route');
    const res = await GET(req());
    const body = await res.json();

    expect(body).toEqual({ ok: true, ...RESULTADO });
    expect(scanAndSummarize).toHaveBeenCalledTimes(1);
  });

  it('rechaza sin el Bearer correcto cuando hay CRON_SECRET', async () => {
    process.env.CRON_SECRET = 's3cr3t';
    const { GET } = await import('./route');

    const res = await GET(req('Bearer otro'));

    expect(res.status).toBe(401);
    expect(scanAndSummarize).not.toHaveBeenCalled();
  });

  it('acepta con el Bearer correcto', async () => {
    process.env.CRON_SECRET = 's3cr3t';
    const { GET } = await import('./route');

    const res = await GET(req('Bearer s3cr3t'));

    expect(res.status).toBe(200);
    expect(scanAndSummarize).toHaveBeenCalledTimes(1);
  });

  it('registra y devuelve 500 si el barrido explota', async () => {
    scanAndSummarize.mockRejectedValue(new Error('boom'));
    const { GET } = await import('./route');

    const res = await GET(req());

    expect(res.status).toBe(500);
    expect(logWorkflowError).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Escribir el test del refresh manual**

Create `app/api/reviews/refresh/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const scanAndSummarize = vi.fn();
vi.mock('@/lib/review-scan', () => ({ scanAndSummarize }));

const requireUser = vi.fn(async () => ({ user: { email: 'x@y.com' }, error: null }));
vi.mock('@/lib/api-auth', () => ({ requireUser }));

vi.mock('@/lib/error-log', () => ({ logWorkflowError: vi.fn(async () => {}) }));

beforeEach(() => {
  scanAndSummarize.mockReset();
  scanAndSummarize.mockResolvedValue({ candidatos: 1, creados: 1, fallidos: 0 });
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { email: 'x@y.com' }, error: null });
});

describe('POST /api/reviews/refresh', () => {
  it('corre el barrido para un usuario autenticado', async () => {
    const { POST } = await import('./route');
    const res = await POST();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.creados).toBe(1);
  });

  it('rechaza si no hay sesión', async () => {
    requireUser.mockResolvedValue({
      user: null,
      error: new Response('No autorizado', { status: 401 }),
    });
    const { POST } = await import('./route');

    const res = await POST();

    expect(res.status).toBe(401);
    expect(scanAndSummarize).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Correr los tests para verificar que fallan**

Run: `npx vitest run app/api/cron/resumenes app/api/reviews/refresh`
Expected: FAIL — no existe `./route` en ninguno de los dos.

- [ ] **Step 4: Implementar la ruta del cron**

Create `app/api/cron/resumenes/route.ts`:

```ts
import { scanAndSummarize } from '@/lib/review-scan';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_resumenes';

export async function GET(req: Request) {
  // Seguridad del cron (Vercel envía Authorization: Bearer $CRON_SECRET).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }
  }

  try {
    const resultado = await scanAndSummarize();
    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'cron', error: err });
    return Response.json({ error: 'Error en el barrido de resúmenes' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Implementar la ruta manual**

Create `app/api/reviews/refresh/route.ts`:

```ts
import { scanAndSummarize } from '@/lib/review-scan';
import { requireUser } from '@/lib/api-auth';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_resumenes';

/**
 * Mismo motor que el cron, disparado a mano desde la bandeja. Existe porque
 * el plan Hobby de Vercel solo permite crons diarios: sin este botón, el
 * equipo tendría que esperar al reloj para ver conversaciones nuevas.
 */
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const resultado = await scanAndSummarize();
    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'refresh_manual', error: err });
    return Response.json({ error: 'No se pudo actualizar la bandeja' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Correr los tests para verificar que pasan**

Run: `npx vitest run app/api/cron/resumenes app/api/reviews/refresh`
Expected: PASS — los 6 tests en verde.

- [ ] **Step 7: Registrar el cron en Vercel**

Modify `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/etiquetas",
      "schedule": "0 15 * * *"
    },
    {
      "path": "/api/cron/resumenes",
      "schedule": "0 13 * * *"
    }
  ]
}
```

> **Nota para quien despliegue:** el plan Hobby de Vercel permite crons **una vez al día**. Con plan Pro se puede pasar a `0 * * * *` (cada hora). Con corrida diaria el sistema funciona igual; el botón "Actualizar bandeja" cubre la diferencia.

- [ ] **Step 8: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/api/cron/resumenes app/api/reviews/refresh vercel.json
git commit -m "feat(revision): rutas de barrido por cron y manual"
```

---

> **Nota para quien ejecute el plan:** hasta acá el sistema ya produce datos.
> Corré `curl -X GET http://localhost:3000/api/cron/resumenes` con `npm run dev`
> levantado (y sin `CRON_SECRET` en `.env.local`) para llenar la bandeja con
> conversaciones reales antes de construir la UI. Verificá con
> `npx tsx scripts/check-feedback-schema.ts` que las tablas responden.

---

### Tarea 6: Reglas aprendidas — máquina de estados y generación por IA

**Files:**
- Create: `lib/learned-rules.ts`
- Test: `lib/learned-rules.test.ts`

**Interfaces:**
- Consumes: `anthropic`, `ANTHROPIC_RULES_MODEL` de `lib/anthropic.ts`; `RULE_AGENT_KEYS`, `isRuleAgentKey`, `type RuleAgentKey` de `lib/review-constants.ts`; `buildTranscript` de `lib/review-summary.ts`; `type ChatbotLog` de `lib/conversation-episodes.ts`.
- Produces:
  - `type RuleStatus = 'propuesta' | 'aprobada' | 'aplicada' | 'rechazada'`
  - `type RuleKind = 'nueva' | 'conflicto'`
  - `type RuleDraft = { kind: RuleKind; agent_key: RuleAgentKey; trigger_text: string; rule_text: string; rationale: string; conflict_excerpt: string | null }`
  - `type LearnedRule = RuleDraft & { id: number; status: RuleStatus }`
  - `canTransition(from: RuleStatus, to: RuleStatus, kind: RuleKind): boolean`
  - `draftRuleFromFeedback(input: { transcript: string; summary: string; comment: string; anchors: { message_out: string; comment: string | null }[]; agente: string; currentPrompt: string }): Promise<RuleDraft>`
  - `buildConsolidatedFragment(rules: Pick<LearnedRule, 'trigger_text' | 'rule_text'>[]): string`
  - `consolidateIntoPrompt(input: { agentKey: string; currentPrompt: string; rules: Pick<LearnedRule, 'trigger_text' | 'rule_text'>[] }): Promise<string>`

---

- [ ] **Step 1: Escribir los tests que fallan**

Create `lib/learned-rules.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create } },
  ANTHROPIC_RULES_MODEL: 'claude-opus-5',
}));

import {
  canTransition,
  draftRuleFromFeedback,
  buildConsolidatedFragment,
  consolidateIntoPrompt,
} from './learned-rules';

function respuestaJson(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function respuestaTexto(texto: string) {
  return { content: [{ type: 'text', text: texto }] };
}

const DRAFT_OK = {
  kind: 'nueva',
  agent_key: 'ventas',
  trigger_text: 'el huésped pregunta cómo llegar desde Liberia',
  rule_text: 'Cuando el huésped pregunte cómo llegar desde el aeropuerto de Liberia, ofrecé primero el traslado privado del lodge con su precio.',
  rationale: 'Perdimos una venta porque el bot mandó al cliente a tomar bus.',
  conflict_excerpt: null,
};

const ENTRADA = {
  transcript: '[turno 1 · log 1]\nHuésped: ¿cómo llego desde Liberia?\nBot: Podés tomar un bus.',
  summary: 'El huésped preguntó cómo llegar.',
  comment: 'Perdimos una venta, el bot mandó al cliente a tomar bus.',
  anchors: [{ message_out: 'Podés tomar un bus.', comment: 'acá falló' }],
  agente: 'ventas',
  currentPrompt: 'Sos el asistente de ventas del lodge.',
};

beforeEach(() => {
  create.mockReset();
});

describe('canTransition', () => {
  it('permite propuesta → aprobada para una regla nueva', () => {
    expect(canTransition('propuesta', 'aprobada', 'nueva')).toBe(true);
  });

  it('permite propuesta → rechazada', () => {
    expect(canTransition('propuesta', 'rechazada', 'nueva')).toBe(true);
  });

  it('permite aprobada → aplicada', () => {
    expect(canTransition('aprobada', 'aplicada', 'nueva')).toBe(true);
  });

  it('permite aprobada → rechazada (arrepentirse antes de aplicar)', () => {
    expect(canTransition('aprobada', 'rechazada', 'nueva')).toBe(true);
  });

  it('NO permite aprobar una regla de tipo conflicto', () => {
    expect(canTransition('propuesta', 'aprobada', 'conflicto')).toBe(false);
  });

  it('permite rechazar una regla de tipo conflicto', () => {
    expect(canTransition('propuesta', 'rechazada', 'conflicto')).toBe(true);
  });

  it('NO permite aplicar una regla rechazada', () => {
    expect(canTransition('rechazada', 'aplicada', 'nueva')).toBe(false);
  });

  it('NO permite aprobar una regla ya aplicada', () => {
    expect(canTransition('aplicada', 'aprobada', 'nueva')).toBe(false);
  });

  it('NO permite saltarse la aprobación (propuesta → aplicada)', () => {
    expect(canTransition('propuesta', 'aplicada', 'nueva')).toBe(false);
  });

  it('aplicada y rechazada son terminales', () => {
    expect(canTransition('aplicada', 'rechazada', 'nueva')).toBe(false);
    expect(canTransition('rechazada', 'aprobada', 'nueva')).toBe(false);
  });
});

describe('draftRuleFromFeedback', () => {
  it('devuelve la regla propuesta', async () => {
    create.mockResolvedValue(respuestaJson(DRAFT_OK));

    const draft = await draftRuleFromFeedback(ENTRADA);

    expect(draft.kind).toBe('nueva');
    expect(draft.agent_key).toBe('ventas');
    expect(draft.trigger_text).toContain('Liberia');
    expect(draft.conflict_excerpt).toBeNull();
  });

  it('usa el modelo de reglas', async () => {
    create.mockResolvedValue(respuestaJson(DRAFT_OK));

    await draftRuleFromFeedback(ENTRADA);

    expect(create.mock.calls[0][0].model).toBe('claude-opus-5');
  });

  it('le pasa el prompt actual del agente — es lo que evita duplicados', async () => {
    create.mockResolvedValue(respuestaJson(DRAFT_OK));

    await draftRuleFromFeedback(ENTRADA);

    const contenido = create.mock.calls[0][0].messages[0].content as string;
    expect(contenido).toContain('Sos el asistente de ventas del lodge.');
    expect(contenido).toContain('Perdimos una venta');
    expect(contenido).toContain('acá falló');
  });

  it('marca conflicto cuando la regla ya existe en el prompt', async () => {
    create.mockResolvedValue(
      respuestaJson({
        ...DRAFT_OK,
        kind: 'conflicto',
        conflict_excerpt: 'Ofrecé siempre el traslado privado antes que el bus.',
      }),
    );

    const draft = await draftRuleFromFeedback(ENTRADA);

    expect(draft.kind).toBe('conflicto');
    expect(draft.conflict_excerpt).toContain('traslado privado');
  });

  it('cae al agente del episodio si el modelo devuelve una clave inválida', async () => {
    create.mockResolvedValue(respuestaJson({ ...DRAFT_OK, agent_key: 'recepcion' }));

    const draft = await draftRuleFromFeedback(ENTRADA);

    expect(draft.agent_key).toBe('ventas');
  });

  it('cae a "soporte" si ni el modelo ni el episodio traen un agente válido', async () => {
    create.mockResolvedValue(respuestaJson({ ...DRAFT_OK, agent_key: 'x' }));

    const draft = await draftRuleFromFeedback({ ...ENTRADA, agente: 'escalamiento' });

    expect(draft.agent_key).toBe('soporte');
  });

  it('lanza si el modelo devuelve una regla vacía', async () => {
    create.mockResolvedValue(respuestaJson({ ...DRAFT_OK, rule_text: '   ' }));

    await expect(draftRuleFromFeedback(ENTRADA)).rejects.toThrow(/regla vacía/i);
  });

  it('propaga el error de la API', async () => {
    create.mockRejectedValue(new Error('429 rate limit'));

    await expect(draftRuleFromFeedback(ENTRADA)).rejects.toThrow('429 rate limit');
  });
});

describe('buildConsolidatedFragment', () => {
  it('numera las reglas con su condición y su acción', () => {
    const frag = buildConsolidatedFragment([
      { trigger_text: 'preguntan por transporte', rule_text: 'Ofrecé el traslado privado.' },
      { trigger_text: 'preguntan por el desayuno', rule_text: 'Decí que está incluido.' },
    ]);

    expect(frag).toContain('1.');
    expect(frag).toContain('preguntan por transporte');
    expect(frag).toContain('Ofrecé el traslado privado.');
    expect(frag).toContain('2.');
    expect(frag).toContain('Decí que está incluido.');
  });
});

describe('consolidateIntoPrompt', () => {
  it('devuelve el prompt completo modificado', async () => {
    create.mockResolvedValue(respuestaTexto('PROMPT NUEVO COMPLETO'));

    const res = await consolidateIntoPrompt({
      agentKey: 'ventas',
      currentPrompt: 'PROMPT VIEJO',
      rules: [{ trigger_text: 'x', rule_text: 'y' }],
    });

    expect(res).toBe('PROMPT NUEVO COMPLETO');
    expect(create.mock.calls[0][0].model).toBe('claude-opus-5');
  });

  it('limpia las triple-comillas si el modelo las agrega', async () => {
    create.mockResolvedValue(respuestaTexto('```\nPROMPT NUEVO\n```'));

    const res = await consolidateIntoPrompt({
      agentKey: 'ventas',
      currentPrompt: 'PROMPT VIEJO',
      rules: [{ trigger_text: 'x', rule_text: 'y' }],
    });

    expect(res).toBe('PROMPT NUEVO');
  });

  it('rechaza sin reglas: no tiene sentido tocar el prompt', async () => {
    await expect(
      consolidateIntoPrompt({ agentKey: 'ventas', currentPrompt: 'P', rules: [] }),
    ).rejects.toThrow(/sin reglas/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('lanza si el modelo devuelve un prompt vacío — nunca borra el prompt vivo', async () => {
    create.mockResolvedValue(respuestaTexto('   '));

    await expect(
      consolidateIntoPrompt({
        agentKey: 'ventas',
        currentPrompt: 'PROMPT VIEJO',
        rules: [{ trigger_text: 'x', rule_text: 'y' }],
      }),
    ).rejects.toThrow(/vacío/i);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/learned-rules.test.ts`
Expected: FAIL — `Failed to resolve import "./learned-rules"`.

- [ ] **Step 3: Implementar el módulo**

Create `lib/learned-rules.ts`:

```ts
import 'server-only';
import { anthropic, ANTHROPIC_RULES_MODEL } from '@/lib/anthropic';
import { isRuleAgentKey, RULE_AGENT_KEYS, type RuleAgentKey } from '@/lib/review-constants';

/**
 * Reglas aprendidas: el puente entre el comentario de una persona y el
 * system_prompt del agente.
 *
 * Nada acá escribe en la base: eso vive en las rutas. Este módulo tiene la
 * máquina de estados (pura, muy testeada) y las dos llamadas a Claude.
 */

export type RuleStatus = 'propuesta' | 'aprobada' | 'aplicada' | 'rechazada';
export type RuleKind = 'nueva' | 'conflicto';

export type RuleDraft = {
  kind: RuleKind;
  agent_key: RuleAgentKey;
  trigger_text: string;
  rule_text: string;
  rationale: string;
  conflict_excerpt: string | null;
};

export type LearnedRule = RuleDraft & { id: number; status: RuleStatus };

const TRANSICIONES: Record<RuleStatus, RuleStatus[]> = {
  propuesta: ['aprobada', 'rechazada'],
  aprobada: ['aplicada', 'rechazada'],
  aplicada: [],
  rechazada: [],
};

/**
 * ¿Es válido pasar de `from` a `to`?
 *
 * Una regla de tipo `conflicto` nunca puede aprobarse: significa que el prompt
 * YA contiene la regla y el bot no la siguió. Agregarla otra vez solo infla el
 * prompt y lo acerca a contradecirse consigo mismo.
 */
export function canTransition(from: RuleStatus, to: RuleStatus, kind: RuleKind): boolean {
  if (kind === 'conflicto' && to === 'aprobada') return false;
  return TRANSICIONES[from]?.includes(to) ?? false;
}

// ── Feedback → regla ──────────────────────────────────────────────

const SYSTEM_REGLA = `Sos un editor de system prompts para los agentes de WhatsApp de un lodge en Costa Rica (Natural Lodge Caño Negro). Recibís:
1. Una conversación real entre un huésped y el bot.
2. El resumen de esa conversación.
3. El comentario de una persona del equipo diciendo qué estuvo mal o qué debería haber pasado.
4. El system prompt COMPLETO que tiene hoy ese agente.

Tu tarea: decidir si falta una regla o si la regla ya existe.

- Si el comportamiento que pide la persona NO está cubierto por el prompt actual, devolvés kind="nueva" con la regla redactada para insertarse en el prompt.
- Si el prompt actual YA cubre ese comportamiento, devolvés kind="conflicto" y en conflict_excerpt copiás TEXTUAL la línea o el párrafo del prompt que lo cubre. En ese caso el problema no es que falte la regla, es que el bot no la siguió.

Reglas de redacción (para kind="nueva"):
- rule_text va en español neutro, en segunda persona dirigida al modelo ("Cuando el huésped..."), en imperativo, en el mismo tono y formato del prompt actual.
- Conservá textual todo dato concreto que aparezca en el comentario (precios, horarios, links, números).
- Entre 1 y 6 líneas. Concreta y accionable, no una declaración de principios.
- trigger_text describe en pocas palabras CUÁNDO aplica, en lenguaje llano, para que alguien no técnico lo entienda de un vistazo.
- rationale es el porqué, resumido de lo que dijo la persona.
- No agregues placeholders ni datos del huésped: esos los inyecta el sistema.
- agent_key es el agente al que debe aplicarse: soporte (huéspedes con reserva), bigday (concurso de avistamiento de aves) o ventas (prospectos).`;

const SCHEMA_REGLA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['nueva', 'conflicto'] },
    agent_key: { type: 'string', enum: [...RULE_AGENT_KEYS] },
    trigger_text: { type: 'string' },
    rule_text: { type: 'string' },
    rationale: { type: 'string' },
    conflict_excerpt: { type: ['string', 'null'] },
  },
  required: ['kind', 'agent_key', 'trigger_text', 'rule_text', 'rationale', 'conflict_excerpt'],
  additionalProperties: false,
} as const;

export async function draftRuleFromFeedback(input: {
  transcript: string;
  summary: string;
  comment: string;
  anchors: { message_out: string; comment: string | null }[];
  agente: string;
  currentPrompt: string;
}): Promise<RuleDraft> {
  const anclajes = input.anchors.length
    ? input.anchors
        .map((a, i) => `${i + 1}. Respuesta marcada: "${a.message_out}"\n   Comentario: ${a.comment || '(sin comentario)'}`)
        .join('\n')
    : '(la persona no marcó ninguna respuesta puntual)';

  const contenido = [
    `Agente que atendió: ${input.agente}`,
    '',
    '=== CONVERSACIÓN ===',
    input.transcript,
    '=== FIN CONVERSACIÓN ===',
    '',
    `Resumen: ${input.summary}`,
    '',
    '=== COMENTARIO DEL EQUIPO ===',
    input.comment || '(sin comentario general)',
    '',
    'Respuestas puntuales marcadas:',
    anclajes,
    '=== FIN COMENTARIO ===',
    '',
    '=== PROMPT ACTUAL DEL AGENTE ===',
    input.currentPrompt,
    '=== FIN PROMPT ACTUAL ===',
  ].join('\n');

  const res = await anthropic.messages.create({
    model: ANTHROPIC_RULES_MODEL,
    max_tokens: 8192,
    system: SYSTEM_REGLA,
    output_config: { format: { type: 'json_schema', schema: SCHEMA_REGLA } },
    messages: [{ role: 'user', content: contenido }],
  } as Parameters<typeof anthropic.messages.create>[0]);

  const bloque = res.content.find((b) => b.type === 'text');
  if (!bloque || bloque.type !== 'text') {
    throw new Error('El modelo devolvió una regla vacía');
  }

  const bruto = JSON.parse(bloque.text) as RuleDraft;
  const ruleText = String(bruto.rule_text ?? '').trim();
  if (!ruleText) throw new Error('El modelo devolvió una regla vacía');

  // Si el modelo eligió un agente que no existe, se cae al del episodio; si
  // ese tampoco es un agente con prompt (escalamiento, sistema), a soporte.
  const agentKey: RuleAgentKey = isRuleAgentKey(bruto.agent_key)
    ? bruto.agent_key
    : isRuleAgentKey(input.agente)
      ? input.agente
      : 'soporte';

  const kind: RuleKind = bruto.kind === 'conflicto' ? 'conflicto' : 'nueva';

  return {
    kind,
    agent_key: agentKey,
    trigger_text: String(bruto.trigger_text ?? '').trim(),
    rule_text: ruleText,
    rationale: String(bruto.rationale ?? '').trim(),
    conflict_excerpt: kind === 'conflicto' ? String(bruto.conflict_excerpt ?? '').trim() || null : null,
  };
}

// ── Reglas aprobadas → prompt ─────────────────────────────────────

/** Texto legible de las reglas que van a integrarse. Exportado para tests y UI. */
export function buildConsolidatedFragment(
  rules: Pick<LearnedRule, 'trigger_text' | 'rule_text'>[],
): string {
  return rules
    .map((r, i) => `${i + 1}. Cuándo aplica: ${r.trigger_text}\n   Qué debe hacer: ${r.rule_text}`)
    .join('\n\n');
}

const SYSTEM_CONSOLIDAR = `Sos un editor de system prompts para agentes de IA. Recibís:
1. El system prompt actual de un agente.
2. Un conjunto de reglas nuevas que deben quedar incorporadas.

Tu tarea: devolver el system prompt completo modificado, con cada regla insertada en el lugar más coherente — agrupada con su sección temática, sin duplicar reglas existentes, sin perder ninguna instrucción previa, manteniendo el estilo, formato y voz del prompt original.

Reglas estrictas:
- Devolvé ÚNICAMENTE el prompt final completo, sin explicaciones, sin comentarios, sin envolverlo en triple-backticks.
- No agregues secciones nuevas si una regla encaja en una existente.
- Si una regla contradice algo del prompt actual, dale prioridad a la regla nueva y eliminá la instrucción anterior.
- Conservá literal todo dato concreto de las reglas (precios, horarios, links, números).
- No cambies el tono ni el idioma del prompt original.
- No agregues placeholders ni metadatos del huésped: esos los inyecta el sistema.`;

export async function consolidateIntoPrompt(input: {
  agentKey: string;
  currentPrompt: string;
  rules: Pick<LearnedRule, 'trigger_text' | 'rule_text'>[];
}): Promise<string> {
  if (input.rules.length === 0) {
    throw new Error('No se puede preparar un cambio sin reglas aprobadas');
  }

  const res = await anthropic.messages.create({
    model: ANTHROPIC_RULES_MODEL,
    max_tokens: 16000,
    system: SYSTEM_CONSOLIDAR,
    messages: [
      {
        role: 'user',
        content: [
          `Agente: ${input.agentKey}`,
          '',
          '=== PROMPT ACTUAL ===',
          input.currentPrompt,
          '=== FIN PROMPT ACTUAL ===',
          '',
          '=== REGLAS A INTEGRAR ===',
          buildConsolidatedFragment(input.rules),
          '=== FIN REGLAS ===',
          '',
          'Devolveme el prompt final completo con las reglas integradas.',
        ].join('\n'),
      },
    ],
  });

  const texto = res.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n')
    .trim()
    // El prompt de sistema pide no envolver en backticks, pero si el modelo
    // igual lo hace, guardarlos corrompería el prompt vivo.
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .trim();

  if (!texto) {
    throw new Error('El modelo devolvió un prompt vacío; no se aplica ningún cambio');
  }

  return texto;
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/learned-rules.test.ts`
Expected: PASS — los 22 tests en verde.

- [ ] **Step 5: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/learned-rules.ts lib/learned-rules.test.ts
git commit -m "feat(revision): reglas aprendidas con máquina de estados y detección de conflictos"
```

---

### Tarea 7: Versiones del prompt

**Files:**
- Create: `lib/prompt-versions.ts`
- Test: `lib/prompt-versions.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` de `lib/supabase/admin.ts`.
- Produces:
  - `type PromptVersion = { id: number; agent_key: string; version_number: number; system_prompt: string; change_summary: string | null; rule_ids: number[]; created_by: string | null; created_at: string }`
  - `applyPromptChange(input: { agentKey: string; systemPrompt: string; ruleIds: number[]; changeSummary: string; userEmail: string }): Promise<{ versionId: number; versionNumber: number }>`
  - `listVersions(agentKey: string, limit?: number): Promise<PromptVersion[]>`
  - `restoreVersion(input: { agentKey: string; versionId: number; userEmail: string }): Promise<{ versionId: number; versionNumber: number }>`

---

- [ ] **Step 1: Escribir los tests que fallan**

Create `lib/prompt-versions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let rpcArgs: Record<string, unknown> | null = null;
let rpcResult: { data: unknown; error: unknown } = {
  data: [{ version_id: 9, version_number: 3 }],
  error: null,
};
let versionRow: Record<string, unknown> | null = null;
let versionesLista: unknown[] = [];

const createAdminClient = vi.fn(() => ({
  rpc: async (nombre: string, args: Record<string, unknown>) => {
    if (nombre !== 'nlcn_apply_prompt_version') throw new Error(`rpc inesperada: ${nombre}`);
    rpcArgs = args;
    return rpcResult;
  },
  from(tabla: string) {
    if (tabla !== 'nlcn_prompt_versions') throw new Error(`tabla inesperada: ${tabla}`);
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: versionRow, error: null }) }),
          order: () => ({ limit: async () => ({ data: versionesLista, error: null }) }),
        }),
      }),
    };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));

import { applyPromptChange, listVersions, restoreVersion } from './prompt-versions';

beforeEach(() => {
  rpcArgs = null;
  rpcResult = { data: [{ version_id: 9, version_number: 3 }], error: null };
  versionRow = null;
  versionesLista = [];
});

describe('applyPromptChange', () => {
  it('llama a la función atómica con los parámetros correctos', async () => {
    const res = await applyPromptChange({
      agentKey: 'ventas',
      systemPrompt: 'PROMPT NUEVO',
      ruleIds: [1, 2],
      changeSummary: '2 reglas integradas',
      userEmail: 'ale@bralto.io',
    });

    expect(res).toEqual({ versionId: 9, versionNumber: 3 });
    expect(rpcArgs).toEqual({
      p_agent_key: 'ventas',
      p_system_prompt: 'PROMPT NUEVO',
      p_rule_ids: [1, 2],
      p_change_summary: '2 reglas integradas',
      p_created_by: 'ale@bralto.io',
    });
  });

  it('lanza si la función SQL devuelve error', async () => {
    rpcResult = { data: null, error: { message: 'No existe el agente x' } };

    await expect(
      applyPromptChange({
        agentKey: 'x',
        systemPrompt: 'P',
        ruleIds: [],
        changeSummary: 's',
        userEmail: 'a@b.c',
      }),
    ).rejects.toThrow('No existe el agente x');
  });

  it('lanza si el prompt viene vacío — nunca se borra el prompt vivo', async () => {
    await expect(
      applyPromptChange({
        agentKey: 'ventas',
        systemPrompt: '   ',
        ruleIds: [],
        changeSummary: 's',
        userEmail: 'a@b.c',
      }),
    ).rejects.toThrow(/vacío/i);
    expect(rpcArgs).toBeNull();
  });
});

describe('listVersions', () => {
  it('devuelve las versiones normalizando rule_ids', async () => {
    versionesLista = [
      { id: 2, agent_key: 'ventas', version_number: 2, system_prompt: 'P2', change_summary: null, rule_ids: [3], created_by: null, created_at: '2026-08-01T00:00:00Z' },
    ];

    const res = await listVersions('ventas');

    expect(res).toHaveLength(1);
    expect(res[0].rule_ids).toEqual([3]);
  });

  it('rule_ids nulo se normaliza a lista vacía', async () => {
    versionesLista = [
      { id: 1, agent_key: 'ventas', version_number: 1, system_prompt: 'P1', change_summary: null, rule_ids: null, created_by: null, created_at: '2026-08-01T00:00:00Z' },
    ];

    expect((await listVersions('ventas'))[0].rule_ids).toEqual([]);
  });
});

describe('restoreVersion', () => {
  it('escribe el prompt de la versión pedida como versión nueva', async () => {
    versionRow = { id: 4, version_number: 2, system_prompt: 'PROMPT DE LA V2' };

    const res = await restoreVersion({
      agentKey: 'ventas',
      versionId: 4,
      userEmail: 'ale@bralto.io',
    });

    expect(res).toEqual({ versionId: 9, versionNumber: 3 });
    expect(rpcArgs?.p_system_prompt).toBe('PROMPT DE LA V2');
    expect(rpcArgs?.p_change_summary).toBe('Restaurado desde v2');
    expect(rpcArgs?.p_rule_ids).toEqual([]);
  });

  it('lanza si la versión no existe o no es de ese agente', async () => {
    versionRow = null;

    await expect(
      restoreVersion({ agentKey: 'ventas', versionId: 99, userEmail: 'a@b.c' }),
    ).rejects.toThrow(/no existe/i);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/prompt-versions.test.ts`
Expected: FAIL — `Failed to resolve import "./prompt-versions"`.

- [ ] **Step 3: Implementar el módulo**

Create `lib/prompt-versions.ts`:

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Historial de versiones del system_prompt.
 *
 * Toda escritura pasa por la función SQL `nlcn_apply_prompt_version`, que
 * crea la versión, actualiza el prompt vivo y marca las reglas como aplicadas
 * dentro de una sola transacción. Si algo falla, Postgres revierte todo: nunca
 * queda un prompt actualizado sin su versión de respaldo.
 */

export type PromptVersion = {
  id: number;
  agent_key: string;
  version_number: number;
  system_prompt: string;
  change_summary: string | null;
  rule_ids: number[];
  created_by: string | null;
  created_at: string;
};

export async function applyPromptChange(input: {
  agentKey: string;
  systemPrompt: string;
  ruleIds: number[];
  changeSummary: string;
  userEmail: string;
}): Promise<{ versionId: number; versionNumber: number }> {
  const prompt = input.systemPrompt.trim();
  if (!prompt) {
    throw new Error('El prompt está vacío; no se aplica ningún cambio');
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('nlcn_apply_prompt_version', {
    p_agent_key: input.agentKey,
    p_system_prompt: prompt,
    p_rule_ids: input.ruleIds,
    p_change_summary: input.changeSummary,
    p_created_by: input.userEmail,
  });

  if (error) throw new Error(error.message);

  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error('La función de aplicación no devolvió la versión creada');

  return { versionId: Number(fila.version_id), versionNumber: Number(fila.version_number) };
}

export async function listVersions(agentKey: string, limit = 20): Promise<PromptVersion[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('nlcn_prompt_versions')
    .select('*')
    .eq('agent_key', agentKey)
    .order('version_number', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? []).map((v: Record<string, unknown>) => ({
    ...(v as unknown as PromptVersion),
    rule_ids: Array.isArray(v.rule_ids) ? (v.rule_ids as number[]) : [],
  }));
}

/**
 * Restaurar no reescribe el historial: toma el texto de la versión pedida y lo
 * aplica como una versión NUEVA. Así queda registro de que se restauró y se
 * puede volver a avanzar sin perder nada.
 */
export async function restoreVersion(input: {
  agentKey: string;
  versionId: number;
  userEmail: string;
}): Promise<{ versionId: number; versionNumber: number }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('nlcn_prompt_versions')
    .select('id, version_number, system_prompt')
    .eq('agent_key', input.agentKey)
    .eq('id', input.versionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('La versión no existe para este agente');

  return applyPromptChange({
    agentKey: input.agentKey,
    systemPrompt: String(data.system_prompt),
    ruleIds: [],
    changeSummary: `Restaurado desde v${data.version_number}`,
    userEmail: input.userEmail,
  });
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/prompt-versions.test.ts`
Expected: PASS — los 7 tests en verde.

- [ ] **Step 5: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt-versions.ts lib/prompt-versions.test.ts
git commit -m "feat(revision): historial de versiones del prompt con restauración"
```

---

*(Continúa en la Parte 2 del plan: persistencia de revisiones, rutas de feedback y compuertas, y la interfaz.)*

### Tarea 8: Persistencia de revisiones y feedback

**Files:**
- Create: `lib/reviews.ts`
- Test: `lib/reviews.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` de `lib/supabase/admin.ts`; `buildTranscript` de `lib/review-summary.ts`; `draftRuleFromFeedback`, `type RuleStatus`, `type RuleKind` de `lib/learned-rules.ts`; `type ChatbotLog` de `lib/conversation-episodes.ts`; `type Signal` de `lib/conversation-episodes.ts`.
- Produces:
  - `type ReviewRow = { id: number; phone: string; agente: string; contact_id: string | null; window_start: string; window_end: string; turn_count: number; summary: string | null; topics: string[]; outcome: string | null; risk_score: number; signals: Signal[]; priority: number; status: string; human_rating: string | null; human_comment: string | null; reviewed_by: string | null; reviewed_at: string | null }`
  - `type AnchorInput = { chatbot_log_id: number; verdict: 'bien' | 'mal'; comment: string | null }`
  - `type RuleRow = { id: number; agent_key: string; source_review_id: number | null; trigger_text: string; rule_text: string; rationale: string | null; kind: RuleKind; conflict_excerpt: string | null; status: RuleStatus; rejection_reason: string | null; created_by: string | null; created_at: string }`
  - `type ReviewDetail = { review: ReviewRow; logs: ChatbotLog[]; anchors: (AnchorInput & { id: number })[]; rules: RuleRow[] }`
  - `listReviews(opts?: { status?: string; agente?: string; limit?: number }): Promise<ReviewRow[]>`
  - `getReviewDetail(id: number): Promise<ReviewDetail | null>`
  - `saveFeedback(input: { reviewId: number; rating: 'bien' | 'regular' | 'mal'; comment: string; anchors: AnchorInput[]; userEmail: string }): Promise<void>`
  - `generateRuleForReview(reviewId: number, userEmail: string): Promise<RuleRow | null>`

---

- [ ] **Step 1: Escribir los tests que fallan**

Create `lib/reviews.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const draftRuleFromFeedback = vi.fn();
vi.mock('@/lib/learned-rules', () => ({ draftRuleFromFeedback }));

/** Estado mutable del doble de Supabase. */
const db = {
  review: null as Record<string, unknown> | null,
  logs: [] as Record<string, unknown>[],
  anchors: [] as Record<string, unknown>[],
  rules: [] as Record<string, unknown>[],
  prompt: null as Record<string, unknown> | null,
  lista: [] as Record<string, unknown>[],
};

const escrituras = {
  reviewUpdate: null as Record<string, unknown> | null,
  anchorsBorrados: 0,
  anchorsInsertados: [] as Record<string, unknown>[],
  reglaInsertada: null as Record<string, unknown> | null,
};

const createAdminClient = vi.fn(() => ({
  from(tabla: string) {
    if (tabla === 'nlcn_conversation_reviews') {
      return {
        select: () => {
          const q: Record<string, unknown> = {
            eq: () => q,
            order: () => q,
            limit: async () => ({ data: db.lista, error: null }),
            maybeSingle: async () => ({ data: db.review, error: null }),
          };
          return q;
        },
        update: (fila: Record<string, unknown>) => ({
          eq: async () => {
            escrituras.reviewUpdate = fila;
            return { error: null };
          },
        }),
      };
    }
    if (tabla === 'chatbot_logs') {
      return {
        select: () => ({ eq: () => ({ gte: () => ({ lte: () => ({ order: async () => ({ data: db.logs, error: null }) }) }) }) }),
      };
    }
    if (tabla === 'nlcn_message_feedback') {
      return {
        select: () => ({ eq: async () => ({ data: db.anchors, error: null }) }),
        delete: () => ({
          eq: async () => {
            escrituras.anchorsBorrados++;
            return { error: null };
          },
        }),
        insert: async (filas: Record<string, unknown>[]) => {
          escrituras.anchorsInsertados.push(...filas);
          return { error: null };
        },
      };
    }
    if (tabla === 'nlcn_learned_rules') {
      return {
        select: () => ({ eq: () => ({ order: async () => ({ data: db.rules, error: null }) }) }),
        insert: (fila: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              escrituras.reglaInsertada = fila;
              return { data: { id: 77, ...fila }, error: null };
            },
          }),
        }),
      };
    }
    if (tabla === 'nlcn_agent_prompts') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.prompt, error: null }) }) }),
      };
    }
    throw new Error(`tabla inesperada: ${tabla}`);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));

import { listReviews, getReviewDetail, saveFeedback, generateRuleForReview } from './reviews';

const REVIEW = {
  id: 5,
  phone: '+50688887777',
  agente: 'ventas',
  contact_id: 'c1',
  window_start: '2026-07-01T10:00:00Z',
  window_end: '2026-07-01T10:30:00Z',
  turn_count: 3,
  summary: 'El huésped preguntó cómo llegar.',
  topics: ['traslados'],
  outcome: 'sin_resolver',
  risk_score: 40,
  signals: ['derivado_ventas'],
  priority: 60,
  status: 'pendiente',
  human_rating: null,
  human_comment: null,
  reviewed_by: null,
  reviewed_at: null,
};

const LOG = {
  id: 1,
  phone: '+50688887777',
  contact_id: 'c1',
  message_in: '¿cómo llego?',
  message_out: 'Podés tomar un bus.',
  has_reservation: false,
  agente_usado: 'ventas',
  transferir_a_ventas: false,
  created_at: '2026-07-01T10:00:00Z',
};

const DRAFT = {
  kind: 'nueva',
  agent_key: 'ventas',
  trigger_text: 'preguntan cómo llegar',
  rule_text: 'Ofrecé el traslado privado.',
  rationale: 'perdimos una venta',
  conflict_excerpt: null,
};

beforeEach(() => {
  db.review = { ...REVIEW };
  db.logs = [LOG];
  db.anchors = [];
  db.rules = [];
  db.prompt = { system_prompt: 'PROMPT DE VENTAS' };
  db.lista = [REVIEW];
  escrituras.reviewUpdate = null;
  escrituras.anchorsBorrados = 0;
  escrituras.anchorsInsertados = [];
  escrituras.reglaInsertada = null;
  draftRuleFromFeedback.mockReset();
  draftRuleFromFeedback.mockResolvedValue(DRAFT);
});

describe('listReviews', () => {
  it('normaliza topics y signals', async () => {
    db.lista = [{ ...REVIEW, topics: null, signals: null }];

    const res = await listReviews();

    expect(res[0].topics).toEqual([]);
    expect(res[0].signals).toEqual([]);
  });
});

describe('getReviewDetail', () => {
  it('devuelve la revisión con sus logs, anclajes y reglas', async () => {
    db.anchors = [{ id: 1, chatbot_log_id: 1, verdict: 'mal', comment: 'acá falló' }];
    db.rules = [{ id: 9, agent_key: 'ventas', status: 'propuesta' }];

    const res = await getReviewDetail(5);

    expect(res?.review.id).toBe(5);
    expect(res?.logs).toHaveLength(1);
    expect(res?.anchors).toHaveLength(1);
    expect(res?.rules).toHaveLength(1);
  });

  it('devuelve null si la revisión no existe', async () => {
    db.review = null;
    expect(await getReviewDetail(999)).toBeNull();
  });
});

describe('saveFeedback', () => {
  it('guarda calificación, comentario y marca la revisión como revisada', async () => {
    await saveFeedback({
      reviewId: 5,
      rating: 'mal',
      comment: 'perdimos una venta',
      anchors: [],
      userEmail: 'ale@bralto.io',
    });

    expect(escrituras.reviewUpdate).toMatchObject({
      human_rating: 'mal',
      human_comment: 'perdimos una venta',
      status: 'revisada',
      reviewed_by: 'ale@bralto.io',
    });
    expect(escrituras.reviewUpdate?.reviewed_at).toEqual(expect.any(String));
  });

  it('reemplaza los anclajes previos en vez de acumularlos', async () => {
    await saveFeedback({
      reviewId: 5,
      rating: 'mal',
      comment: '',
      anchors: [{ chatbot_log_id: 1, verdict: 'mal', comment: 'acá' }],
      userEmail: 'ale@bralto.io',
    });

    expect(escrituras.anchorsBorrados).toBe(1);
    expect(escrituras.anchorsInsertados).toHaveLength(1);
    expect(escrituras.anchorsInsertados[0]).toMatchObject({
      review_id: 5,
      chatbot_log_id: 1,
      verdict: 'mal',
    });
  });

  it('sin anclajes no inserta nada pero igual limpia los viejos', async () => {
    await saveFeedback({ reviewId: 5, rating: 'bien', comment: '', anchors: [], userEmail: 'a@b.c' });

    expect(escrituras.anchorsBorrados).toBe(1);
    expect(escrituras.anchorsInsertados).toHaveLength(0);
  });
});

describe('generateRuleForReview', () => {
  it('genera la regla y la guarda en estado propuesta', async () => {
    db.review = { ...REVIEW, human_comment: 'perdimos una venta' };

    const regla = await generateRuleForReview(5, 'ale@bralto.io');

    expect(regla?.id).toBe(77);
    expect(escrituras.reglaInsertada).toMatchObject({
      agent_key: 'ventas',
      source_review_id: 5,
      status: 'propuesta',
      kind: 'nueva',
      created_by: 'ale@bralto.io',
    });
  });

  it('le pasa a la IA el prompt actual del agente', async () => {
    db.review = { ...REVIEW, human_comment: 'perdimos una venta' };

    await generateRuleForReview(5, 'ale@bralto.io');

    expect(draftRuleFromFeedback.mock.calls[0][0].currentPrompt).toBe('PROMPT DE VENTAS');
  });

  it('incluye los anclajes con el texto de la respuesta marcada', async () => {
    db.review = { ...REVIEW, human_comment: 'x' };
    db.anchors = [{ id: 1, chatbot_log_id: 1, verdict: 'mal', comment: 'acá falló' }];

    await generateRuleForReview(5, 'ale@bralto.io');

    expect(draftRuleFromFeedback.mock.calls[0][0].anchors).toEqual([
      { message_out: 'Podés tomar un bus.', comment: 'acá falló' },
    ]);
  });

  it('no genera nada si no hay comentario ni anclajes', async () => {
    db.review = { ...REVIEW, human_comment: null };

    expect(await generateRuleForReview(5, 'a@b.c')).toBeNull();
    expect(draftRuleFromFeedback).not.toHaveBeenCalled();
  });

  it('devuelve null si la revisión no existe', async () => {
    db.review = null;
    expect(await generateRuleForReview(999, 'a@b.c')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run lib/reviews.test.ts`
Expected: FAIL — `Failed to resolve import "./reviews"`.

- [ ] **Step 3: Implementar el módulo**

Create `lib/reviews.ts`:

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildTranscript } from '@/lib/review-summary';
import { draftRuleFromFeedback, type RuleKind, type RuleStatus } from '@/lib/learned-rules';
import type { ChatbotLog, Signal } from '@/lib/conversation-episodes';

/**
 * Persistencia de la bandeja de revisión. Las rutas API son envolturas
 * delgadas sobre estas funciones, lo que las hace testeables mockeando este
 * módulo en lugar de simular toda la cadena de Supabase.
 */

export type ReviewRow = {
  id: number;
  phone: string;
  agente: string;
  contact_id: string | null;
  window_start: string;
  window_end: string;
  turn_count: number;
  summary: string | null;
  topics: string[];
  outcome: string | null;
  risk_score: number;
  signals: Signal[];
  priority: number;
  status: string;
  human_rating: string | null;
  human_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export type AnchorInput = {
  chatbot_log_id: number;
  verdict: 'bien' | 'mal';
  comment: string | null;
};

export type RuleRow = {
  id: number;
  agent_key: string;
  source_review_id: number | null;
  trigger_text: string;
  rule_text: string;
  rationale: string | null;
  kind: RuleKind;
  conflict_excerpt: string | null;
  status: RuleStatus;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type ReviewDetail = {
  review: ReviewRow;
  logs: ChatbotLog[];
  anchors: (AnchorInput & { id: number })[];
  rules: RuleRow[];
};

function normalizarReview(fila: Record<string, unknown>): ReviewRow {
  return {
    ...(fila as unknown as ReviewRow),
    topics: Array.isArray(fila.topics) ? (fila.topics as string[]) : [],
    signals: Array.isArray(fila.signals) ? (fila.signals as Signal[]) : [],
  };
}

export async function listReviews(opts?: {
  status?: string;
  agente?: string;
  limit?: number;
}): Promise<ReviewRow[]> {
  const supabase = createAdminClient();
  let q = supabase
    .from('nlcn_conversation_reviews')
    .select('*')
    .order('priority', { ascending: false })
    .order('window_end', { ascending: false });

  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.agente) q = q.eq('agente', opts.agente);

  const { data, error } = await q.limit(opts?.limit ?? 100);
  if (error) throw new Error(error.message);

  return (data ?? []).map(normalizarReview);
}

export async function getReviewDetail(id: number): Promise<ReviewDetail | null> {
  const supabase = createAdminClient();

  const { data: fila, error } = await supabase
    .from('nlcn_conversation_reviews')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!fila) return null;

  const review = normalizarReview(fila);

  // Los logs del episodio se recuperan por su ventana temporal: es la misma
  // definición que usó el barrido para crear la revisión.
  const { data: logs } = await supabase
    .from('chatbot_logs')
    .select(
      'id, phone, contact_id, message_in, message_out, has_reservation, agente_usado, transferir_a_ventas, created_at',
    )
    .eq('phone', review.phone)
    .gte('created_at', review.window_start)
    .lte('created_at', review.window_end)
    .order('created_at', { ascending: true });

  const { data: anchors } = await supabase
    .from('nlcn_message_feedback')
    .select('id, chatbot_log_id, verdict, comment')
    .eq('review_id', id);

  const { data: rules } = await supabase
    .from('nlcn_learned_rules')
    .select('*')
    .eq('source_review_id', id)
    .order('created_at', { ascending: false });

  return {
    review,
    logs: (logs ?? []) as ChatbotLog[],
    anchors: (anchors ?? []) as (AnchorInput & { id: number })[],
    rules: (rules ?? []) as RuleRow[],
  };
}

/**
 * Guarda el trabajo de la persona. Se llama SIEMPRE antes de tocar la IA:
 * ningún fallo del modelo puede hacer que alguien pierda lo que escribió.
 */
export async function saveFeedback(input: {
  reviewId: number;
  rating: 'bien' | 'regular' | 'mal';
  comment: string;
  anchors: AnchorInput[];
  userEmail: string;
}): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('nlcn_conversation_reviews')
    .update({
      human_rating: input.rating,
      human_comment: input.comment.trim() || null,
      status: 'revisada',
      reviewed_by: input.userEmail,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', input.reviewId);

  if (error) throw new Error(error.message);

  // Reemplazo, no acumulación: si alguien reabre la conversación y cambia de
  // opinión sobre qué respuesta falló, deben quedar solo sus marcas actuales.
  await supabase.from('nlcn_message_feedback').delete().eq('review_id', input.reviewId);

  if (input.anchors.length > 0) {
    const { error: insertError } = await supabase.from('nlcn_message_feedback').insert(
      input.anchors.map((a) => ({
        review_id: input.reviewId,
        chatbot_log_id: a.chatbot_log_id,
        verdict: a.verdict,
        comment: a.comment?.trim() || null,
        created_by: input.userEmail,
      })),
    );
    if (insertError) throw new Error(insertError.message);
  }
}

/**
 * Convierte el feedback ya guardado en una regla propuesta. Devuelve null si
 * no hay nada que convertir (calificación sin comentario ni marcas).
 */
export async function generateRuleForReview(
  reviewId: number,
  userEmail: string,
): Promise<RuleRow | null> {
  const detalle = await getReviewDetail(reviewId);
  if (!detalle) return null;

  const comentario = detalle.review.human_comment?.trim() || '';
  const conComentarioEnAnclaje = detalle.anchors.some((a) => a.comment?.trim());
  if (!comentario && !conComentarioEnAnclaje) return null;

  const supabase = createAdminClient();
  const { data: promptRow } = await supabase
    .from('nlcn_agent_prompts')
    .select('system_prompt')
    .eq('agent_key', detalle.review.agente)
    .maybeSingle();

  const porId = new Map(detalle.logs.map((l) => [l.id, l]));

  const draft = await draftRuleFromFeedback({
    transcript: buildTranscript(detalle.logs),
    summary: detalle.review.summary || '',
    comment: comentario,
    anchors: detalle.anchors.map((a) => ({
      message_out: porId.get(a.chatbot_log_id)?.message_out || '',
      comment: a.comment,
    })),
    agente: detalle.review.agente,
    currentPrompt: String(promptRow?.system_prompt || ''),
  });

  const { data, error } = await supabase
    .from('nlcn_learned_rules')
    .insert({
      agent_key: draft.agent_key,
      source_review_id: reviewId,
      trigger_text: draft.trigger_text,
      rule_text: draft.rule_text,
      rationale: draft.rationale,
      kind: draft.kind,
      conflict_excerpt: draft.conflict_excerpt,
      status: 'propuesta',
      created_by: userEmail,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as RuleRow;
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run lib/reviews.test.ts`
Expected: PASS — los 11 tests en verde.

- [ ] **Step 5: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/reviews.ts lib/reviews.test.ts
git commit -m "feat(revision): persistencia de revisiones y generación de reglas desde el feedback"
```

---

### Tarea 9: Rutas de feedback

**Files:**
- Create: `app/api/reviews/[id]/feedback/route.ts`
- Create: `app/api/reviews/[id]/retry-rule/route.ts`
- Test: `app/api/reviews/[id]/feedback/route.test.ts`

**Interfaces:**
- Consumes: `saveFeedback`, `generateRuleForReview` de `lib/reviews.ts`; `requireUser` de `lib/api-auth.ts`.
- Produces: `POST /api/reviews/[id]/feedback` → `{ ok: true, rule: RuleRow | null, ruleError: string | null }`; `POST /api/reviews/[id]/retry-rule` → `{ ok: true, rule: RuleRow | null }`.

> **Recordatorio de esta versión de Next:** `params` es una **Promise**. La firma es `(req: Request, { params }: { params: Promise<{ id: string }> })` y hay que `await params`.

---

- [ ] **Step 1: Escribir el test que falla**

Create `app/api/reviews/[id]/feedback/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const saveFeedback = vi.fn(async () => {});
const generateRuleForReview = vi.fn();
vi.mock('@/lib/reviews', () => ({ saveFeedback, generateRuleForReview }));

const requireUser = vi.fn();
vi.mock('@/lib/api-auth', () => ({ requireUser }));

vi.mock('@/lib/error-log', () => ({ logWorkflowError: vi.fn(async () => {}) }));

const REGLA = { id: 77, agent_key: 'ventas', kind: 'nueva', status: 'propuesta' };

function req(body: unknown): Request {
  return new Request('http://t/api/reviews/5/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: '5' }) };

beforeEach(() => {
  saveFeedback.mockClear();
  generateRuleForReview.mockReset();
  generateRuleForReview.mockResolvedValue(REGLA);
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { email: 'ale@bralto.io' }, error: null });
});

describe('POST /api/reviews/[id]/feedback', () => {
  it('guarda el feedback y devuelve la regla generada', async () => {
    const { POST } = await import('./route');

    const res = await POST(req({ rating: 'mal', comment: 'perdimos una venta', anchors: [] }), ctx);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.rule.id).toBe(77);
    expect(saveFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 5, rating: 'mal', userEmail: 'ale@bralto.io' }),
    );
  });

  it('rechaza sin sesión', async () => {
    requireUser.mockResolvedValue({ user: null, error: new Response('No autorizado', { status: 401 }) });
    const { POST } = await import('./route');

    const res = await POST(req({ rating: 'mal' }), ctx);

    expect(res.status).toBe(401);
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it('rechaza una calificación inválida', async () => {
    const { POST } = await import('./route');

    const res = await POST(req({ rating: 'excelente' }), ctx);

    expect(res.status).toBe(400);
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it('rechaza un id no numérico', async () => {
    const { POST } = await import('./route');

    const res = await POST(req({ rating: 'bien' }), { params: Promise.resolve({ id: 'abc' }) });

    expect(res.status).toBe(400);
  });

  it('si la IA falla, el feedback IGUAL queda guardado', async () => {
    generateRuleForReview.mockRejectedValue(new Error('529 overloaded'));
    const { POST } = await import('./route');

    const res = await POST(req({ rating: 'mal', comment: 'x', anchors: [] }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rule).toBeNull();
    expect(body.ruleError).toMatch(/no se pudo generar/i);
    expect(saveFeedback).toHaveBeenCalledTimes(1);
  });

  it('devuelve 500 si falla el guardado del feedback', async () => {
    saveFeedback.mockRejectedValueOnce(new Error('db caída'));
    const { POST } = await import('./route');

    const res = await POST(req({ rating: 'bien' }), ctx);

    expect(res.status).toBe(500);
  });

  it('normaliza los anclajes descartando los que no traen log válido', async () => {
    const { POST } = await import('./route');

    await POST(
      req({
        rating: 'mal',
        comment: '',
        anchors: [
          { chatbot_log_id: 1, verdict: 'mal', comment: 'acá' },
          { chatbot_log_id: 'x', verdict: 'mal', comment: null },
          { chatbot_log_id: 2, verdict: 'inventado', comment: null },
        ],
      }),
      ctx,
    );

    expect(saveFeedback.mock.calls[0][0].anchors).toEqual([
      { chatbot_log_id: 1, verdict: 'mal', comment: 'acá' },
    ]);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run app/api/reviews`
Expected: FAIL — no existe `./route`.

- [ ] **Step 3: Implementar la ruta de feedback**

Create `app/api/reviews/[id]/feedback/route.ts`:

```ts
import { requireUser } from '@/lib/api-auth';
import { saveFeedback, generateRuleForReview, type AnchorInput } from '@/lib/reviews';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_feedback';
const RATINGS = ['bien', 'regular', 'mal'] as const;
type Rating = (typeof RATINGS)[number];

type Body = {
  rating?: string;
  comment?: string;
  anchors?: unknown;
};

/** Descarta anclajes malformados en vez de rechazar todo el envío. */
function normalizarAnclajes(valor: unknown): AnchorInput[] {
  if (!Array.isArray(valor)) return [];
  const salida: AnchorInput[] = [];
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Record<string, unknown>;
    const logId = Number(a.chatbot_log_id);
    if (!Number.isInteger(logId)) continue;
    if (a.verdict !== 'bien' && a.verdict !== 'mal') continue;
    salida.push({
      chatbot_log_id: logId,
      verdict: a.verdict,
      comment: typeof a.comment === 'string' ? a.comment : null,
    });
  }
  return salida;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: 'Id de revisión inválido' }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const rating = body.rating as Rating;
  if (!RATINGS.includes(rating)) {
    return Response.json({ error: 'La calificación debe ser bien, regular o mal' }, { status: 400 });
  }

  const userEmail = auth.user?.email || 'desconocido';
  const anchors = normalizarAnclajes(body.anchors);

  // Primero se guarda el trabajo de la persona. Recién después se llama a la
  // IA: si el modelo falla, el feedback ya está a salvo.
  try {
    await saveFeedback({
      reviewId,
      rating,
      comment: typeof body.comment === 'string' ? body.comment : '',
      anchors,
      userEmail,
    });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'guardar_feedback', error: err, context: { reviewId } });
    return Response.json({ error: 'No se pudo guardar la revisión' }, { status: 500 });
  }

  try {
    const rule = await generateRuleForReview(reviewId, userEmail);
    return Response.json({ ok: true, rule, ruleError: null });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'generar_regla', error: err, context: { reviewId } });
    return Response.json({
      ok: true,
      rule: null,
      ruleError: 'No se pudo generar la regla. Tu revisión quedó guardada; podés reintentar.',
    });
  }
}
```

- [ ] **Step 4: Implementar la ruta de reintento**

Create `app/api/reviews/[id]/retry-rule/route.ts`:

```ts
import { requireUser } from '@/lib/api-auth';
import { generateRuleForReview } from '@/lib/reviews';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_feedback';

/**
 * Reintenta solo la generación de la regla, sin volver a pedirle nada a la
 * persona: su calificación y comentario ya están guardados.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: 'Id de revisión inválido' }, { status: 400 });
  }

  try {
    const rule = await generateRuleForReview(reviewId, auth.user?.email || 'desconocido');
    return Response.json({ ok: true, rule });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'reintentar_regla', error: err, context: { reviewId } });
    return Response.json({ error: 'No se pudo generar la regla' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `npx vitest run app/api/reviews`
Expected: PASS — los 9 tests (7 de feedback + 2 de refresh) en verde.

- [ ] **Step 6: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/reviews
git commit -m "feat(revision): rutas de feedback y reintento de generación de regla"
```

---

### Tarea 10: Compuerta 1 — ruta de aprobación de reglas

**Files:**
- Create: `app/api/rules/[id]/route.ts`
- Test: `app/api/rules/[id]/route.test.ts`

**Interfaces:**
- Consumes: `canTransition`, `type RuleStatus` de `lib/learned-rules.ts`; `requireUser` de `lib/api-auth.ts`; `createAdminClient` de `lib/supabase/admin.ts`.
- Produces: `PATCH /api/rules/[id]` con body `{ action: 'aprobar' | 'rechazar', rule_text?: string, trigger_text?: string, rejection_reason?: string }` → `{ ok: true, rule }`.

---

- [ ] **Step 1: Escribir el test que falla**

Create `app/api/rules/[id]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
vi.mock('@/lib/api-auth', () => ({ requireUser }));

vi.mock('@/lib/error-log', () => ({ logWorkflowError: vi.fn(async () => {}) }));

let reglaActual: Record<string, unknown> | null = null;
let actualizacion: Record<string, unknown> | null = null;

const createAdminClient = vi.fn(() => ({
  from(tabla: string) {
    if (tabla !== 'nlcn_learned_rules') throw new Error(`tabla inesperada: ${tabla}`);
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: reglaActual, error: null }) }) }),
      update: (fila: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              actualizacion = fila;
              return { data: { ...reglaActual, ...fila }, error: null };
            },
          }),
        }),
      }),
    };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));

import { PATCH } from './route';

function req(body: unknown): Request {
  return new Request('http://t/api/rules/9', { method: 'PATCH', body: JSON.stringify(body) });
}

const ctx = { params: Promise.resolve({ id: '9' }) };

beforeEach(() => {
  reglaActual = { id: 9, status: 'propuesta', kind: 'nueva', agent_key: 'ventas' };
  actualizacion = null;
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { email: 'ale@bralto.io' }, error: null });
});

describe('PATCH /api/rules/[id]', () => {
  it('aprueba una regla propuesta', async () => {
    const res = await PATCH(req({ action: 'aprobar' }), ctx);

    expect(res.status).toBe(200);
    expect(actualizacion).toMatchObject({ status: 'aprobada', reviewed_by: 'ale@bralto.io' });
  });

  it('permite editar el texto al aprobar — la última palabra es humana', async () => {
    await PATCH(req({ action: 'aprobar', rule_text: 'TEXTO EDITADO', trigger_text: 'CUÁNDO EDITADO' }), ctx);

    expect(actualizacion).toMatchObject({
      rule_text: 'TEXTO EDITADO',
      trigger_text: 'CUÁNDO EDITADO',
      status: 'aprobada',
    });
  });

  it('rechaza con motivo', async () => {
    await PATCH(req({ action: 'rechazar', rejection_reason: 'no aplica' }), ctx);

    expect(actualizacion).toMatchObject({ status: 'rechazada', rejection_reason: 'no aplica' });
  });

  it('NO deja aprobar una regla de tipo conflicto', async () => {
    reglaActual = { id: 9, status: 'propuesta', kind: 'conflicto', agent_key: 'ventas' };

    const res = await PATCH(req({ action: 'aprobar' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/conflicto|ya (está|existe)/i);
    expect(actualizacion).toBeNull();
  });

  it('NO deja aprobar una regla ya aplicada', async () => {
    reglaActual = { id: 9, status: 'aplicada', kind: 'nueva', agent_key: 'ventas' };

    const res = await PATCH(req({ action: 'aprobar' }), ctx);

    expect(res.status).toBe(409);
    expect(actualizacion).toBeNull();
  });

  it('devuelve 404 si la regla no existe', async () => {
    reglaActual = null;

    const res = await PATCH(req({ action: 'aprobar' }), ctx);

    expect(res.status).toBe(404);
  });

  it('rechaza una acción desconocida', async () => {
    const res = await PATCH(req({ action: 'borrar' }), ctx);

    expect(res.status).toBe(400);
  });

  it('rechaza sin sesión', async () => {
    requireUser.mockResolvedValue({ user: null, error: new Response('No autorizado', { status: 401 }) });

    const res = await PATCH(req({ action: 'aprobar' }), ctx);

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run app/api/rules`
Expected: FAIL — no existe `./route`.

- [ ] **Step 3: Implementar la ruta**

Create `app/api/rules/[id]/route.ts`:

```ts
import { requireUser } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { canTransition, type RuleKind, type RuleStatus } from '@/lib/learned-rules';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKFLOW = 'revision_reglas';

type Body = {
  action?: string;
  rule_text?: string;
  trigger_text?: string;
  rejection_reason?: string;
};

/**
 * Compuerta 1: una persona aprueba, edita o rechaza la regla propuesta.
 * Nada de esto toca el prompt todavía — eso es la compuerta 2.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { id } = await params;
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) {
    return Response.json({ error: 'Id de regla inválido' }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (body.action !== 'aprobar' && body.action !== 'rechazar') {
    return Response.json({ error: 'La acción debe ser aprobar o rechazar' }, { status: 400 });
  }

  const destino: RuleStatus = body.action === 'aprobar' ? 'aprobada' : 'rechazada';

  try {
    const supabase = createAdminClient();

    const { data: regla, error } = await supabase
      .from('nlcn_learned_rules')
      .select('*')
      .eq('id', ruleId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!regla) return Response.json({ error: 'La regla no existe' }, { status: 404 });

    if (!canTransition(regla.status as RuleStatus, destino, regla.kind as RuleKind)) {
      const motivo =
        regla.kind === 'conflicto' && destino === 'aprobada'
          ? 'Esta regla ya está cubierta por el prompt actual: no se puede aprobar, solo rechazar. El problema es que el bot no la siguió.'
          : `No se puede pasar una regla de "${regla.status}" a "${destino}".`;
      return Response.json({ error: motivo }, { status: 409 });
    }

    const cambios: Record<string, unknown> = {
      status: destino,
      reviewed_by: auth.user?.email || 'desconocido',
      reviewed_at: new Date().toISOString(),
    };

    // La persona tiene la última palabra sobre cada palabra de la regla.
    if (destino === 'aprobada') {
      if (typeof body.rule_text === 'string' && body.rule_text.trim()) {
        cambios.rule_text = body.rule_text.trim();
      }
      if (typeof body.trigger_text === 'string' && body.trigger_text.trim()) {
        cambios.trigger_text = body.trigger_text.trim();
      }
    } else {
      cambios.rejection_reason = body.rejection_reason?.trim() || null;
    }

    const { data: actualizada, error: updateError } = await supabase
      .from('nlcn_learned_rules')
      .update(cambios)
      .eq('id', ruleId)
      .select()
      .single();

    if (updateError) throw new Error(updateError.message);

    return Response.json({ ok: true, rule: actualizada });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'patch_regla', error: err, context: { ruleId } });
    return Response.json({ error: 'No se pudo actualizar la regla' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run app/api/rules`
Expected: PASS — los 8 tests en verde.

- [ ] **Step 5: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/rules
git commit -m "feat(revision): compuerta 1 — aprobar, editar o rechazar reglas"
```

---

### Tarea 11: Compuerta 2 — rutas de preparación, aplicación y restauración

**Files:**
- Create: `app/api/prompts/[agentKey]/prepare/route.ts`
- Create: `app/api/prompts/[agentKey]/apply/route.ts`
- Create: `app/api/prompts/[agentKey]/restore/route.ts`
- Test: `app/api/prompts/[agentKey]/apply/route.test.ts`

**Interfaces:**
- Consumes: `consolidateIntoPrompt` de `lib/learned-rules.ts`; `applyPromptChange`, `restoreVersion`, `listVersions` de `lib/prompt-versions.ts`; `requireUser`, `createAdminClient`.
- Produces:
  - `POST /api/prompts/[agentKey]/prepare` → `{ ok: true, before, after, ruleIds, rules }`
  - `POST /api/prompts/[agentKey]/apply` con `{ systemPrompt, ruleIds }` → `{ ok: true, versionId, versionNumber }`
  - `POST /api/prompts/[agentKey]/restore` con `{ versionId }` → `{ ok: true, versionId, versionNumber }`

---

- [ ] **Step 1: Escribir el test que falla**

Create `app/api/prompts/[agentKey]/apply/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
vi.mock('@/lib/api-auth', () => ({ requireUser }));

const applyPromptChange = vi.fn();
vi.mock('@/lib/prompt-versions', () => ({ applyPromptChange, restoreVersion: vi.fn(), listVersions: vi.fn() }));

vi.mock('@/lib/error-log', () => ({ logWorkflowError: vi.fn(async () => {}) }));

let reglasAprobadas: Record<string, unknown>[] = [];

const createAdminClient = vi.fn(() => ({
  from(tabla: string) {
    if (tabla !== 'nlcn_learned_rules') throw new Error(`tabla inesperada: ${tabla}`);
    return {
      select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: reglasAprobadas, error: null }) }) }) }),
    };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));

import { POST } from './route';

function req(body: unknown): Request {
  return new Request('http://t/api/prompts/ventas/apply', { method: 'POST', body: JSON.stringify(body) });
}

const ctx = { params: Promise.resolve({ agentKey: 'ventas' }) };

beforeEach(() => {
  reglasAprobadas = [{ id: 1 }, { id: 2 }];
  applyPromptChange.mockReset();
  applyPromptChange.mockResolvedValue({ versionId: 9, versionNumber: 3 });
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { email: 'ale@bralto.io' }, error: null });
});

describe('POST /api/prompts/[agentKey]/apply', () => {
  it('aplica el cambio y devuelve la versión creada', async () => {
    const res = await POST(req({ systemPrompt: 'PROMPT NUEVO', ruleIds: [1, 2] }), ctx);
    const body = await res.json();

    expect(body).toEqual({ ok: true, versionId: 9, versionNumber: 3 });
    expect(applyPromptChange).toHaveBeenCalledWith(
      expect.objectContaining({ agentKey: 'ventas', systemPrompt: 'PROMPT NUEVO', ruleIds: [1, 2] }),
    );
  });

  it('rechaza un agente que no existe', async () => {
    const res = await POST(req({ systemPrompt: 'P', ruleIds: [1] }), {
      params: Promise.resolve({ agentKey: 'recepcion' }),
    });

    expect(res.status).toBe(400);
    expect(applyPromptChange).not.toHaveBeenCalled();
  });

  it('rechaza un prompt vacío', async () => {
    const res = await POST(req({ systemPrompt: '   ', ruleIds: [1] }), ctx);

    expect(res.status).toBe(400);
    expect(applyPromptChange).not.toHaveBeenCalled();
  });

  it('rechaza si alguna regla enviada ya no está aprobada', async () => {
    // La regla 2 fue rechazada por otra persona mientras se veía el diff.
    reglasAprobadas = [{ id: 1 }];

    const res = await POST(req({ systemPrompt: 'P', ruleIds: [1, 2] }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/cambiaron|ya no/i);
    expect(applyPromptChange).not.toHaveBeenCalled();
  });

  it('rechaza sin sesión', async () => {
    requireUser.mockResolvedValue({ user: null, error: new Response('No autorizado', { status: 401 }) });

    const res = await POST(req({ systemPrompt: 'P', ruleIds: [1] }), ctx);

    expect(res.status).toBe(401);
  });

  it('devuelve 500 si la aplicación atómica falla', async () => {
    applyPromptChange.mockRejectedValue(new Error('deadlock'));

    const res = await POST(req({ systemPrompt: 'P', ruleIds: [1, 2] }), ctx);

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run app/api/prompts`
Expected: FAIL — no existe `./route`.

- [ ] **Step 3: Implementar la ruta de preparación**

Create `app/api/prompts/[agentKey]/prepare/route.ts`:

```ts
import { requireUser } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { consolidateIntoPrompt } from '@/lib/learned-rules';
import { isRuleAgentKey } from '@/lib/review-constants';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'revision_prompt';

/**
 * Consolida las reglas aprobadas de un agente en un prompt propuesto.
 * NO guarda nada: devuelve el antes y el después para que la persona vea el
 * diff y decida. Esa decisión es la compuerta 2 (`/apply`).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ agentKey: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { agentKey } = await params;
  if (!isRuleAgentKey(agentKey)) {
    return Response.json({ error: 'Agente desconocido' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    const { data: promptRow, error: promptError } = await supabase
      .from('nlcn_agent_prompts')
      .select('system_prompt')
      .eq('agent_key', agentKey)
      .maybeSingle();

    if (promptError) throw new Error(promptError.message);
    if (!promptRow) return Response.json({ error: 'El agente no tiene prompt' }, { status: 404 });

    const { data: reglas, error: reglasError } = await supabase
      .from('nlcn_learned_rules')
      .select('id, trigger_text, rule_text')
      .eq('agent_key', agentKey)
      .eq('status', 'aprobada')
      .order('created_at', { ascending: true });

    if (reglasError) throw new Error(reglasError.message);
    if (!reglas || reglas.length === 0) {
      return Response.json({ error: 'No hay reglas aprobadas pendientes de aplicar' }, { status: 400 });
    }

    const before = String(promptRow.system_prompt);
    const after = await consolidateIntoPrompt({ agentKey, currentPrompt: before, rules: reglas });

    return Response.json({
      ok: true,
      before,
      after,
      ruleIds: reglas.map((r) => r.id),
      rules: reglas,
    });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'preparar', error: err, context: { agentKey } });
    return Response.json({ error: 'No se pudo preparar el cambio' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Implementar la ruta de aplicación**

Create `app/api/prompts/[agentKey]/apply/route.ts`:

```ts
import { requireUser } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyPromptChange } from '@/lib/prompt-versions';
import { isRuleAgentKey } from '@/lib/review-constants';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKFLOW = 'revision_prompt';

type Body = { systemPrompt?: string; ruleIds?: unknown };

/**
 * Compuerta 2: aplica al prompt vivo el texto exacto que la persona aprobó.
 */
export async function POST(req: Request, { params }: { params: Promise<{ agentKey: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { agentKey } = await params;
  if (!isRuleAgentKey(agentKey)) {
    return Response.json({ error: 'Agente desconocido' }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
  if (!systemPrompt) {
    return Response.json({ error: 'El prompt no puede quedar vacío' }, { status: 400 });
  }

  const ruleIds = Array.isArray(body.ruleIds)
    ? body.ruleIds.map(Number).filter(Number.isInteger)
    : [];

  try {
    const supabase = createAdminClient();

    // Revalidar contra la base: entre que se preparó el diff y se apretó
    // aplicar, otra persona pudo rechazar una de esas reglas.
    const { data: aprobadas, error } = await supabase
      .from('nlcn_learned_rules')
      .select('id')
      .eq('agent_key', agentKey)
      .eq('status', 'aprobada')
      .in('id', ruleIds.length ? ruleIds : [-1]);

    if (error) throw new Error(error.message);

    if ((aprobadas ?? []).length !== ruleIds.length) {
      return Response.json(
        { error: 'Las reglas cambiaron mientras revisabas. Preparé el cambio de nuevo.' },
        { status: 409 },
      );
    }

    const resultado = await applyPromptChange({
      agentKey,
      systemPrompt,
      ruleIds,
      changeSummary: `${ruleIds.length} regla${ruleIds.length === 1 ? '' : 's'} integrada${ruleIds.length === 1 ? '' : 's'}`,
      userEmail: auth.user?.email || 'desconocido',
    });

    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'aplicar', error: err, context: { agentKey } });
    return Response.json({ error: 'No se pudo aplicar el cambio' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Implementar la ruta de restauración**

Create `app/api/prompts/[agentKey]/restore/route.ts`:

```ts
import { requireUser } from '@/lib/api-auth';
import { restoreVersion } from '@/lib/prompt-versions';
import { isRuleAgentKey } from '@/lib/review-constants';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKFLOW = 'revision_prompt';

type Body = { versionId?: unknown };

export async function POST(req: Request, { params }: { params: Promise<{ agentKey: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { agentKey } = await params;
  if (!isRuleAgentKey(agentKey)) {
    return Response.json({ error: 'Agente desconocido' }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const versionId = Number(body.versionId);
  if (!Number.isInteger(versionId)) {
    return Response.json({ error: 'Id de versión inválido' }, { status: 400 });
  }

  try {
    const resultado = await restoreVersion({
      agentKey,
      versionId,
      userEmail: auth.user?.email || 'desconocido',
    });
    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'restaurar', error: err, context: { agentKey, versionId } });
    return Response.json({ error: 'No se pudo restaurar la versión' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `npx vitest run app/api/prompts`
Expected: PASS — los 6 tests en verde.

- [ ] **Step 7: Verificar tipos y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — toda la suite (existente + nueva) en verde.

- [ ] **Step 8: Commit**

```bash
git add app/api/prompts
git commit -m "feat(revision): compuerta 2 — preparar, aplicar y restaurar el prompt"
```

---

> **Punto de control:** con la Tarea 11 el backend está completo y probado. Antes
> de empezar la interfaz, verificá el ciclo entero por API con `npm run dev`
> levantado: `GET /api/cron/resumenes` (llena la bandeja) → `POST /api/reviews/<id>/feedback`
> con una calificación y un comentario → `PATCH /api/rules/<id>` con `{"action":"aprobar"}`
> → `POST /api/prompts/ventas/prepare` → `POST /api/prompts/ventas/apply`.
> Revisá en Supabase que `nlcn_prompt_versions` tenga la versión nueva y que
> `nlcn_agent_prompts` haya cambiado.

---

*(Continúa en la Parte 3: la interfaz de revisión.)*

## Nota sobre las tareas de interfaz (12 a 15)

El proyecto **no tiene entorno de pruebas de React**: [`vitest.config.ts`](../../../vitest.config.ts)
corre con `environment: 'node'` e incluye solo `lib/**/*.test.ts` y `app/**/*.test.ts`.
Montar `jsdom` + Testing Library sería una funcionalidad aparte, fuera del alcance
de este plan.

Por eso las tareas de interfaz se verifican con:

1. `npx tsc --noEmit` — tipos.
2. `npm run build` — que compile de verdad como componente de servidor/cliente.
3. Una **lista de comprobación manual** en el navegador, explícita en cada tarea.

Toda la lógica que se puede probar sin navegador ya vive en `lib/` y está cubierta
por las tareas 2 a 8.

**Sistema de diseño existente** (de [`app/globals.css`](../../../app/globals.css)) — usalo, no inventes estilos:
`glass`, `glass-lifted`, `glass-inset`, `glass-pill`, `green-line`, `fade-up`;
colores `--color-cream`, `--color-cream-dim`, `--color-cream-mute`, `--color-green`,
`--color-green-glow`, `--color-green-ring`. Iconos: `lucide-react`.

---

### Tarea 12: Página de revisión y bandeja

**Files:**
- Create: `app/api/reviews/[id]/route.ts`
- Create: `app/revision/page.tsx`
- Create: `components/review/ReviewWorkspace.tsx`
- Create: `components/review/ReviewInbox.tsx`
- Modify: `components/AppHeader.tsx`

**Interfaces:**
- Consumes: `listReviews`, `getReviewDetail`, `type ReviewRow`, `type RuleRow`, `type ReviewDetail` de `lib/reviews.ts`; `listVersions`, `type PromptVersion` de `lib/prompt-versions.ts`; `SIGNAL_LABELS`, `type Signal` de `lib/conversation-episodes.ts`.
- Produces:
  - `GET /api/reviews/[id]` → `ReviewDetail | 404`
  - `<ReviewWorkspace user initialReviews initialRules initialPrompts initialVersions />`
  - `<ReviewInbox reviews onOpen onRefresh refreshing />`

---

- [ ] **Step 1: Ruta GET del detalle**

Create `app/api/reviews/[id]/route.ts`:

```ts
import { requireUser } from '@/lib/api-auth';
import { getReviewDetail } from '@/lib/reviews';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId)) {
    return Response.json({ error: 'Id de revisión inválido' }, { status: 400 });
  }

  try {
    const detalle = await getReviewDetail(reviewId);
    if (!detalle) return Response.json({ error: 'La revisión no existe' }, { status: 404 });
    return Response.json(detalle);
  } catch (err) {
    await logWorkflowError({ workflow: 'revision_feedback', node: 'detalle', error: err, context: { reviewId } });
    return Response.json({ error: 'No se pudo cargar la conversación' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: La página (componente de servidor)**

Create `app/revision/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listReviews, type RuleRow } from '@/lib/reviews';
import { listVersions, type PromptVersion } from '@/lib/prompt-versions';
import { RULE_AGENT_KEYS } from '@/lib/review-constants';
import { ReviewWorkspace } from '@/components/review/ReviewWorkspace';
import type { Prompt } from '@/components/AgentWorkspace';

export const dynamic = 'force-dynamic';

export default async function RevisionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  const [reviews, { data: rules }, { data: prompts }] = await Promise.all([
    listReviews({ limit: 100 }),
    admin
      .from('nlcn_learned_rules')
      .select('*')
      .in('status', ['propuesta', 'aprobada'])
      .order('created_at', { ascending: false }),
    admin.from('nlcn_agent_prompts').select('*').order('agent_key'),
  ]);

  // Historial por agente. Son consultas chicas (20 filas por agente como tope).
  const versionesPorAgente: Record<string, PromptVersion[]> = {};
  await Promise.all(
    RULE_AGENT_KEYS.map(async (key) => {
      versionesPorAgente[key] = await listVersions(key);
    }),
  );

  return (
    <ReviewWorkspace
      userEmail={user?.email || null}
      initialReviews={reviews}
      initialRules={(rules || []) as RuleRow[]}
      prompts={(prompts || []) as Prompt[]}
      initialVersions={versionesPorAgente}
    />
  );
}
```

- [ ] **Step 4: El contenedor con pestañas**

Create `components/review/ReviewWorkspace.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Inbox, ListChecks, FileText } from 'lucide-react';
import type { ReviewRow, RuleRow, ReviewDetail } from '@/lib/reviews';
import type { PromptVersion } from '@/lib/prompt-versions';
import type { Prompt } from '@/components/AgentWorkspace';
import { ReviewInbox } from './ReviewInbox';
import { ReviewDetailPanel } from './ReviewDetail';
import { RulesQueue } from './RulesQueue';
import { PromptApply } from './PromptApply';

type Tab = 'bandeja' | 'reglas' | 'prompt';

export function ReviewWorkspace({
  userEmail,
  initialReviews,
  initialRules,
  prompts,
  initialVersions,
}: {
  userEmail: string | null;
  initialReviews: ReviewRow[];
  initialRules: RuleRow[];
  prompts: Prompt[];
  initialVersions: Record<string, PromptVersion[]>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('bandeja');
  const [detalle, setDetalle] = useState<ReviewDetail | null>(null);
  const [cargando, setCargando] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const propuestas = initialRules.filter((r) => r.status === 'propuesta').length;
  const aprobadas = initialRules.filter((r) => r.status === 'aprobada').length;

  async function abrirConversacion(id: number) {
    setCargando(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/reviews/${id}`);
      if (!res.ok) throw new Error('No se pudo cargar la conversación');
      setDetalle((await res.json()) as ReviewDetail);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }

  async function actualizarBandeja() {
    setRefrescando(true);
    setAviso(null);
    try {
      const res = await fetch('/api/reviews/refresh', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo actualizar');
      setAviso(
        body.creados > 0
          ? `${body.creados} conversación${body.creados === 1 ? '' : 'es'} nueva${body.creados === 1 ? '' : 's'} en la bandeja.`
          : 'No hay conversaciones nuevas por revisar.',
      );
      router.refresh();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setRefrescando(false);
    }
  }

  return (
    <div className="relative z-[2] max-w-[1280px] mx-auto px-5 sm:px-9 pt-7 pb-20">
      <header className="glass fade-up flex items-center justify-between gap-4 px-5 py-3.5 relative overflow-hidden">
        <div className="absolute top-0 left-[20%] right-[20%] h-px green-line opacity-50" />
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="glass-pill inline-flex items-center gap-2 px-3.5 py-[7px] rounded-full text-[--color-cream-dim] text-[12.5px] hover:text-[--color-cream] transition"
          >
            <ArrowLeft size={14} />
            Panel
          </Link>
          <div className="min-w-0 leading-[1.2]">
            <div className="text-[16px] font-medium text-[--color-cream] tracking-tight">Revisión</div>
            <div className="text-[10.5px] font-medium text-[--color-cream-mute] uppercase tracking-[0.16em] mt-[2px]">
              Conversaciones y aprendizaje
            </div>
          </div>
        </div>
        {userEmail && (
          <span className="hidden md:inline text-[12.5px] text-[--color-cream-mute] truncate max-w-[220px]">
            {userEmail}
          </span>
        )}
      </header>

      <nav className="flex gap-2 mt-5 fade-up fade-up-1">
        <TabPill activa={tab === 'bandeja'} onClick={() => setTab('bandeja')} icon={<Inbox size={14} />}>
          Bandeja
        </TabPill>
        <TabPill activa={tab === 'reglas'} onClick={() => setTab('reglas')} icon={<ListChecks size={14} />} badge={propuestas}>
          Reglas por revisar
        </TabPill>
        <TabPill activa={tab === 'prompt'} onClick={() => setTab('prompt')} icon={<FileText size={14} />} badge={aprobadas}>
          Aplicar al prompt
        </TabPill>
      </nav>

      {aviso && (
        <p className="glass-inset mt-4 px-4 py-2.5 text-[12.5px] text-[--color-cream-dim]">{aviso}</p>
      )}

      <div className="mt-5">
        {tab === 'bandeja' &&
          (detalle ? (
            <ReviewDetailPanel
              detalle={detalle}
              onCerrar={() => setDetalle(null)}
              onGuardado={() => {
                setDetalle(null);
                router.refresh();
              }}
            />
          ) : (
            <ReviewInbox
              reviews={initialReviews}
              cargando={cargando}
              refrescando={refrescando}
              onAbrir={abrirConversacion}
              onActualizar={actualizarBandeja}
            />
          ))}

        {tab === 'reglas' && (
          <RulesQueue
            rules={initialRules.filter((r) => r.status === 'propuesta')}
            onCambio={() => router.refresh()}
          />
        )}

        {tab === 'prompt' && (
          <PromptApply
            prompts={prompts}
            rules={initialRules.filter((r) => r.status === 'aprobada')}
            versiones={initialVersions}
            onCambio={() => router.refresh()}
          />
        )}
      </div>
    </div>
  );
}

function TabPill({
  activa,
  onClick,
  icon,
  badge,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`glass-pill inline-flex items-center gap-2 px-4 py-[9px] rounded-full text-[12.5px] font-medium transition-all duration-200 ${
        activa ? 'text-[--color-green-glow]' : 'text-[--color-cream-dim] hover:text-[--color-cream]'
      }`}
      style={activa ? { boxShadow: '0 0 0 1px var(--color-green-ring)' } : undefined}
    >
      <span className="opacity-85">{icon}</span>
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="ml-1 px-1.5 py-px rounded-full text-[10.5px] text-[--color-green-glow] bg-[--color-green-soft]">
          {badge}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 5: La bandeja**

Create `components/review/ReviewInbox.tsx`:

```tsx
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

  const agentes = useMemo(
    () => [...new Set(reviews.map((r) => r.agente))].sort(),
    [reviews],
  );

  const visibles = useMemo(
    () =>
      reviews.filter(
        (r) => (!estado || r.status === estado) && (!agente || r.agente === agente),
      ),
    [reviews, estado, agente],
  );

  return (
    <section className="glass fade-up fade-up-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {ESTADOS.map((e) => (
            <FiltroPill key={e.valor} activo={estado === e.valor} onClick={() => setEstado(e.valor)}>
              {e.etiqueta}
            </FiltroPill>
          ))}
          <span className="w-px bg-[--color-glass-border] mx-1" />
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
                            : { color: 'var(--color-cream-mute)', background: 'var(--color-glass-2)' }
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
        activo ? 'text-[--color-green-glow] bg-[--color-green-soft]' : 'text-[--color-cream-mute] hover:text-[--color-cream-dim]'
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 6: Enlace desde el panel principal**

Modify `components/AppHeader.tsx`. Agregar `ClipboardCheck` al import de `lucide-react` y `Link` de `next/link`, y como primer elemento del bloque de acciones (antes de `HeaderPill` de importar contactos):

```tsx
<Link
  href="/revision"
  className="glass-pill inline-flex items-center gap-2 px-4 py-[9px] rounded-full text-[--color-cream-dim] text-[12.5px] font-medium cursor-pointer transition-all duration-200 hover:text-[--color-cream] hover:-translate-y-[1px]"
>
  <span className="opacity-85">
    <ClipboardCheck size={14} />
  </span>
  <span className="hidden sm:inline">Revisión</span>
</Link>
```

- [ ] **Step 7: Verificar tipos y compilación**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS. `ReviewDetail`, `RulesQueue` y `PromptApply` todavía no existen, así que **este paso va a fallar** con "Cannot find module './ReviewDetail'". Eso es esperado: creá los tres archivos como esqueletos que devuelvan `null` para desbloquear la compilación, y las tareas 13, 14 y 15 los llenan.

```tsx
// components/review/ReviewDetail.tsx — esqueleto temporal (Tarea 13)
'use client';
export function ReviewDetailPanel(_props: unknown) {
  return null;
}
```

```tsx
// components/review/RulesQueue.tsx — esqueleto temporal (Tarea 14)
'use client';
export function RulesQueue(_props: unknown) {
  return null;
}
```

```tsx
// components/review/PromptApply.tsx — esqueleto temporal (Tarea 15)
'use client';
export function PromptApply(_props: unknown) {
  return null;
}
```

Volvé a correr `npx tsc --noEmit && npm run build` con los esqueletos: ahora sí debe pasar.

- [ ] **Step 8: Comprobación manual**

Con `npm run dev`:

1. Entrar a `/` → aparece el botón **"Revisión"** en la cabecera.
2. Hacer clic → carga `/revision` sin errores en consola.
3. La pestaña **Bandeja** lista conversaciones ordenadas por prioridad, con chips de señal.
4. Los filtros de estado y de agente reducen la lista.
5. **"Actualizar bandeja"** muestra el spinner y luego un aviso con el conteo.
6. Hacer clic en una conversación no rompe nada (el panel de detalle todavía es un esqueleto vacío).

- [ ] **Step 9: Commit**

```bash
git add app/api/reviews/\[id\]/route.ts app/revision components/review components/AppHeader.tsx
git commit -m "feat(revision): página de revisión y bandeja priorizada"
```

---

### Tarea 13: Ficha de conversación

**Files:**
- Modify: `components/review/ReviewDetail.tsx` (reemplaza el esqueleto)

**Interfaces:**
- Consumes: `type ReviewDetail`, `type AnchorInput` de `lib/reviews.ts`; `SIGNAL_LABELS` de `lib/conversation-episodes.ts`.
- Produces: `<ReviewDetailPanel detalle onCerrar onGuardado />`

---

- [ ] **Step 1: Implementar la ficha**

Replace `components/review/ReviewDetail.tsx`:

```tsx
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
  const [reglaGenerada, setReglaGenerada] = useState<{ trigger_text: string; rule_text: string; kind: string } | null>(null);
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

      if (body.rule) setReglaGenerada(body.rule);
      if (body.ruleError) setErrorRegla(body.ruleError);

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
      if (body.rule) setReglaGenerada(body.rule);
      else setErrorRegla('No había comentario para convertir en regla.');
    } catch (err) {
      setErrorRegla(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setReintentando(false);
    }
  }

  return (
    <section className="glass fade-up p-5">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onCerrar}
          className="glass-pill inline-flex items-center gap-2 px-3.5 py-[7px] rounded-full text-[--color-cream-dim] text-[12.5px] hover:text-[--color-cream] transition"
        >
          <ArrowLeft size={14} />
          Volver a la bandeja
        </button>
        <span className="text-[13px] text-[--color-cream] font-medium">{review.phone}</span>
        <span className="text-[11px] text-[--color-cream-mute] uppercase tracking-[0.1em]">{review.agente}</span>
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
                        <BotonMarca activo={marca?.verdict === 'bien'} onClick={() => marcar(l.id, 'bien')}>
                          <ThumbsUp size={12} />
                        </BotonMarca>
                        <BotonMarca activo={marca?.verdict === 'mal'} onClick={() => marcar(l.id, 'mal')}>
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
                <strong className="text-[--color-cream]">Qué debe hacer:</strong> {reglaGenerada.rule_text}
              </p>
              <p className="text-[12px] text-[--color-cream-faint] mt-2">
                Queda pendiente de tu aprobación en <strong>Reglas por revisar</strong>. El bot todavía no cambió.
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
        activo ? 'text-[--color-green-glow] bg-[--color-green-soft]' : 'text-[--color-cream-faint] hover:text-[--color-cream-dim]'
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Verificar tipos y compilación**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Comprobación manual**

Con `npm run dev`, en `/revision`:

1. Abrir una conversación → aparecen las dos columnas.
2. La columna derecha muestra los turnos reales; cada respuesta del bot tiene 👍/👎.
3. Marcar 👎 → aparece la barra roja y el campo de comentario.
4. Volver a apretar 👎 → se quita la marca.
5. Guardar **sin** elegir calificación → mensaje "Elegí una calificación antes de guardar."
6. Elegir "Estuvo mal", escribir un comentario, guardar → aparece la **regla propuesta** con "Cuándo" y "Qué debe hacer".
7. Guardar solo con calificación (sin comentario) → vuelve a la bandeja y la conversación queda como **revisada**.

- [ ] **Step 4: Commit**

```bash
git add components/review/ReviewDetail.tsx
git commit -m "feat(revision): ficha de conversación con calificación y marcado por mensaje"
```

---

### Tarea 14: Compuerta 1 en la interfaz — cola de reglas

**Files:**
- Modify: `components/review/RulesQueue.tsx` (reemplaza el esqueleto)

**Interfaces:**
- Consumes: `type RuleRow` de `lib/reviews.ts`.
- Produces: `<RulesQueue rules onCambio />`

---

- [ ] **Step 1: Implementar la cola**

Replace `components/review/RulesQueue.tsx`:

```tsx
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
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[11px] uppercase tracking-[0.1em] text-[--color-cream-mute]">
          {regla.agent_key}
        </span>
        {regla.source_review_id && (
          <span className="text-[11px] text-[--color-cream-faint]">
            de la conversación #{regla.source_review_id}
          </span>
        )}
        <span className="ml-auto text-[11px] text-[--color-cream-faint]">
          {new Date(regla.created_at).toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica' })}
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
```

- [ ] **Step 2: Verificar tipos y compilación**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Comprobación manual**

En `/revision`, pestaña **Reglas por revisar**:

1. Aparecen las reglas propuestas con "Cuándo" y "Qué debe hacer" en lenguaje llano.
2. **Editar** abre los campos; **Guardar y aprobar** aplica el texto editado.
3. **Rechazar** pide confirmación con un campo de motivo, y al confirmar la regla desaparece.
4. Una regla de tipo **conflicto** aparece en su sección aparte, **sin botón de aprobar**, y muestra la cita del prompt que ya la cubre.
5. Tras aprobar, el contador de la pestaña **Aplicar al prompt** sube.

- [ ] **Step 4: Commit**

```bash
git add components/review/RulesQueue.tsx
git commit -m "feat(revision): cola de aprobación de reglas (compuerta 1)"
```

---

### Tarea 15: Compuerta 2 en la interfaz, historial y cierre

**Files:**
- Modify: `components/review/PromptApply.tsx` (reemplaza el esqueleto)

**Interfaces:**
- Consumes: `type RuleRow` de `lib/reviews.ts`; `type PromptVersion` de `lib/prompt-versions.ts`; `type Prompt` de `components/AgentWorkspace.tsx`; `DiffView` de `components/DiffView.tsx`.
- Produces: `<PromptApply prompts rules versiones onCambio />`

---

- [ ] **Step 1: Implementar la aplicación al prompt**

Replace `components/review/PromptApply.tsx`:

```tsx
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

      {aviso && <p className="glass-inset px-4 py-2.5 text-[12.5px] text-[--color-green-glow] mb-4">{aviso}</p>}
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
                <span className="text-[12.5px] text-[--color-cream] font-medium">v{v.version_number}</span>
                <span className="text-[12px] text-[--color-cream-dim]">{v.change_summary || '—'}</span>
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
```

- [ ] **Step 2: Verificar tipos, compilación y toda la suite**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS en los tres.

- [ ] **Step 3: Comprobación manual del ciclo completo**

Con `npm run dev`, recorré el ciclo de punta a punta:

1. `/revision` → **Actualizar bandeja** → aparecen conversaciones.
2. Abrir una, calificarla **mal**, marcar una respuesta con 👎 y escribir qué debería haber hecho → **Guardar revisión** → aparece la regla propuesta.
3. Pestaña **Reglas por revisar** → editar el texto → **Guardar y aprobar**.
4. Pestaña **Aplicar al prompt** → el agente correspondiente muestra la regla pendiente → **Preparar cambio** → aparece el **diff**.
5. **Aplicar al prompt** → aviso con el número de versión nueva.
6. Volver a `/` → el prompt del agente en el panel principal **muestra el texto actualizado**.
7. En **Historial** → **Restaurar** la versión anterior → confirmar → el prompt vuelve, y aparece una versión nueva con "Restaurado desde vN".
8. Verificar en Supabase: `nlcn_prompt_versions` tiene las versiones, y la regla quedó en estado `aplicada` con su `applied_version_id`.

- [ ] **Step 4: Commit**

```bash
git add components/review/PromptApply.tsx
git commit -m "feat(revision): compuerta 2 con diff, aplicación e historial restaurable"
```

- [ ] **Step 5: Verificación final antes de entregar**

```bash
npx tsc --noEmit
npm test
npm run build
npx tsx scripts/check-feedback-schema.ts
git status
```

Expected: tipos limpios, toda la suite en verde, build exitoso, esquema verificado, y el árbol de trabajo sin cambios sueltos que no sean los archivos sin seguimiento que ya existían antes del plan (`*.csv`, `*.xlsx`, `natural-lodge-panel.html`, el JSON del chatbot v2).

---

## Autorrevisión del plan

**Cobertura del spec** — cada sección del diseño tiene su tarea:

| Sección del spec | Tarea |
|---|---|
| §5.1–5.4 modelo de datos | 1 |
| §4 episodios · §6.2 señales | 2 |
| §7.1 resumen | 3 |
| §6.1 barrido | 4 |
| §8.2 rutas de barrido · §8.4 botón manual · cron | 5 |
| §7.2 feedback → regla · §5.3 máquina de estados · §7.3 consolidación | 6 |
| §5.4 versiones · §10 aplicación atómica | 7 |
| §9 orden de guardado | 8, 9 |
| §8.2 rutas de feedback | 9 |
| Compuerta 1 | 10 (API), 14 (UI) |
| Compuerta 2 + restaurar | 11 (API), 15 (UI) |
| §8.3 componentes · §8.4 bandeja | 12, 13, 14, 15 |
| §7.4 configuración de modelos | 1 |
| §10 manejo de errores | 4 (barrido), 9 (feedback), 11 (aplicación) |
| §11 pruebas | 2, 3, 4, 6, 7, 8 |
| §13 fuera de alcance | respetado: sin roles, sin notificaciones, sin gráficos |

**Sin marcadores de posición:** ningún paso dice "TBD", "similar a la tarea N" ni "agregá manejo de errores". Todo paso de código trae el código.

**Consistencia de tipos:** `ReviewRow`, `RuleRow`, `AnchorInput`, `ReviewDetail`, `PromptVersion`, `Episode`, `ChatbotLog`, `Signal`, `RuleStatus`, `RuleKind` y `RuleDraft` se definen una sola vez y se consumen con el mismo nombre en todas las tareas posteriores. Las funciones (`splitIntoEpisodes`, `detectSignals`, `signalWeight`, `summarizeEpisode`, `buildTranscript`, `scanAndSummarize`, `listReviews`, `getReviewDetail`, `saveFeedback`, `generateRuleForReview`, `canTransition`, `draftRuleFromFeedback`, `buildConsolidatedFragment`, `consolidateIntoPrompt`, `applyPromptChange`, `listVersions`, `restoreVersion`) conservan su firma exacta entre la sección "Produces" que las define y cada tarea que las usa.

**Ajuste hecho durante la revisión:** la Tarea 12 necesitaba `GET /api/reviews/[id]`, que el spec no listaba entre las rutas de §8.2 — se agregó al plan como primer paso de esa tarea.
