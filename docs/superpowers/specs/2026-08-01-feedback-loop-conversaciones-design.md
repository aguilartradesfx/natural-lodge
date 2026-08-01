# Ciclo de retroalimentación del chatbot: resumen → revisión humana → regla → prompt

**Fecha:** 2026-08-01
**Proyecto:** nlcn-panel (Next.js 16 + Supabase + GHL + Claude)
**Estado:** Diseño aprobado, pendiente de plan de implementación

---

## 1. Qué es (en simple)

Hoy el chatbot responde y nadie sabe si respondió bien. Este sistema cierra el ciclo:
resume cada conversación, la pone en una bandeja para que una persona la revise, convierte
ese comentario humano en una **regla aprendida**, y — con dos aprobaciones explícitas —
la integra al prompt del agente.

**El principio que ordena todo el diseño: el bot nunca cambia solo.** La IA propone; una
persona decide. Dos veces.

**Recorrido del usuario, paso a paso:**

1. El equipo entra al panel → sección **"Revisión"**.
2. Ve una **bandeja de conversaciones** ordenada por prioridad, cada una con su resumen
   en una línea y chips de color señalando qué salió mal.
3. Abre una: a la izquierda el resumen de la IA, a la derecha la conversación real.
4. Califica (**bien / regular / mal**), y si quiere marca la respuesta puntual del bot que
   falló y escribe **"¿qué debería haber hecho?"**.
5. Ese comentario se convierte en una **regla aprendida** propuesta.
6. **Compuerta 1** — alguien revisa la regla en lenguaje llano y la **aprueba, edita o rechaza**.
7. Las reglas aprobadas se acumulan. Cuando el equipo quiere, aprieta **"Preparar cambio"**.
8. **Compuerta 2** — se muestra el **diff** exacto contra el prompt actual. Alguien lo
   aplica o lo descarta.
9. La versión anterior del prompt queda guardada y **restaurable en un clic**.

---

## 2. El ciclo completo

```
chatbot_logs + nlcn_chat_memory        ← lo que ya existe
        │
        │  cron: episodios sin actividad ≥6h y sin resumen
        ▼
nlcn_conversation_reviews              resumen + señales + estado
        │
        │  persona califica y comenta en la bandeja
        ▼
nlcn_learned_rules  (propuesta)         la IA convierte el comentario en regla
        │
        │  ══ COMPUERTA 1 ══  humano edita / aprueba / rechaza
        ▼
nlcn_learned_rules  (aprobada)          se acumulan por agente
        │
        │  "Preparar cambio" → merge con IA → diff
        │  ══ COMPUERTA 2 ══  humano ve el texto exacto y aplica
        ▼
nlcn_agent_prompts                      prompt actualizado
nlcn_prompt_versions                    versión anterior guardada y restaurable
```

---

## 3. Sobre qué se construye (lo que ya existe)

| Pieza existente | Qué aporta |
|---|---|
| `chatbot_logs` | Un registro por turno: `phone`, `contact_id`, `message_in`, `message_out`, `has_reservation`, `agente_usado`, `transferir_a_ventas`, `created_at`. Es la materia prima del resumen y de las señales. |
| `nlcn_chat_memory` | Memoria conversacional por `session_key` (`<phone>_<agente>`). |
| `nlcn_agent_prompts` | El `system_prompt` editable por agente (`soporte`, `bigday`, `ventas`). **Sin historial hoy.** |
| [`app/api/prompt-assistant/generate`](../../../app/api/prompt-assistant/generate/route.ts) | Idea coloquial → fragmento de prompt. |
| [`app/api/prompt-assistant/merge`](../../../app/api/prompt-assistant/merge/route.ts) | Fragmento + prompt actual → prompt integrado completo. |
| [`components/DiffView.tsx`](../../../components/DiffView.tsx) | Vista de diferencias ya construida. |
| [`app/api/cron/etiquetas`](../../../app/api/cron/etiquetas/route.ts) | Patrón de cron a copiar. |
| [`lib/error-log.ts`](../../../lib/error-log.ts) | `logWorkflowError` → `logs_workflow_errors`. |
| `vitest` | Suite de pruebas configurada. |

---

## 4. Concepto clave: el episodio

No existe un "fin de conversación" real en WhatsApp. Definimos un **episodio** como un
bloque de mensajes de un mismo `(phone, agente)` separado del siguiente por **≥6 horas
de silencio**.

- Si el huésped vuelve a escribir tres días después, eso es un **episodio nuevo**, con su
  propio resumen.
- Cada resumen cubre un rango de tiempo cerrado (`window_start` → `window_end`), lo que
  hace el barrido idempotente y auditable.
- El umbral de 6 horas es configurable por variable de entorno (`REVIEW_IDLE_HOURS`, por
  defecto `6`).

---

## 5. Modelo de datos

Cuatro tablas nuevas. Una migración nueva en `supabase/migrations/`, con
`CREATE TABLE IF NOT EXISTS` siguiendo el patrón del proyecto.

### 5.1 `nlcn_conversation_reviews`

Una fila por episodio.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `BIGSERIAL PK` | |
| `phone` | `TEXT NOT NULL` | |
| `agente` | `TEXT NOT NULL` | `soporte` \| `bigday` \| `ventas` \| `escalamiento` \| `sistema` |
| `contact_id` | `TEXT` | Para enlazar a GHL |
| `window_start` | `TIMESTAMPTZ NOT NULL` | Primer mensaje del episodio |
| `window_end` | `TIMESTAMPTZ NOT NULL` | Último mensaje del episodio |
| `turn_count` | `INTEGER NOT NULL DEFAULT 0` | |
| `summary` | `TEXT` | Narrativo, generado por IA |
| `topics` | `JSONB` | Array de strings |
| `outcome` | `TEXT` | `resuelto` \| `sin_resolver` \| `escalado` \| `derivado_ventas` \| `indeterminado` |
| `risk_score` | `INTEGER` | 0–100, lo devuelve la IA |
| `signals` | `JSONB` | Array de señales heurísticas detectadas |
| `priority` | `INTEGER NOT NULL DEFAULT 0` | Peso heurístico + `risk_score`. Ordena la bandeja. |
| `status` | `TEXT NOT NULL DEFAULT 'pendiente'` | `pendiente` \| `revisada` \| `descartada` |
| `human_rating` | `TEXT` | `bien` \| `regular` \| `mal` |
| `human_comment` | `TEXT` | |
| `reviewed_by` | `TEXT` | Email del usuario del panel |
| `reviewed_at` | `TIMESTAMPTZ` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

**Restricción de idempotencia:** `UNIQUE (phone, agente, window_end)`.
El cron puede correr dos veces sobre los mismos datos sin duplicar nada.

**Índices:** `(status, priority DESC)` para la bandeja; `(created_at)` para métricas.

### 5.2 `nlcn_message_feedback`

Anclaje a una respuesta puntual del bot. Varios por revisión.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `BIGSERIAL PK` | |
| `review_id` | `BIGINT NOT NULL` | FK → `nlcn_conversation_reviews(id)` ON DELETE CASCADE |
| `chatbot_log_id` | `BIGINT NOT NULL` | FK lógica → `chatbot_logs(id)` |
| `verdict` | `TEXT NOT NULL` | `bien` \| `mal` |
| `comment` | `TEXT` | |
| `created_by` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

### 5.3 `nlcn_learned_rules`

La regla aprendida, con su ciclo de vida.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `BIGSERIAL PK` | |
| `agent_key` | `TEXT NOT NULL` | A qué agente aplica |
| `source_review_id` | `BIGINT` | FK → `nlcn_conversation_reviews(id)` ON DELETE SET NULL |
| `trigger_text` | `TEXT NOT NULL` | "Cuando el huésped pregunta por transporte desde Liberia" |
| `rule_text` | `TEXT NOT NULL` | El fragmento en imperativo, listo para el prompt |
| `rationale` | `TEXT` | El porqué, en palabras del revisor |
| `kind` | `TEXT NOT NULL DEFAULT 'nueva'` | `nueva` \| `conflicto` (ver §7.2) |
| `conflict_excerpt` | `TEXT` | Si `kind = 'conflicto'`: la línea del prompt que ya lo cubre |
| `status` | `TEXT NOT NULL DEFAULT 'propuesta'` | `propuesta` \| `aprobada` \| `aplicada` \| `rechazada` |
| `rejection_reason` | `TEXT` | |
| `created_by` | `TEXT` | Quien dejó el feedback |
| `reviewed_by` | `TEXT` | Quien aprobó/rechazó (compuerta 1) |
| `reviewed_at` | `TIMESTAMPTZ` | |
| `applied_version_id` | `BIGINT` | FK → `nlcn_prompt_versions(id)` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

**Máquina de estados** (se valida en código y se prueba):

```
propuesta ──aprobar──▶ aprobada ──aplicar──▶ aplicada   (terminal)
    │                      │
    └──rechazar──▶ rechazada (terminal)  ◀──rechazar────┘
```

Una regla `aplicada` o `rechazada` no admite más transiciones.
Una regla con `kind = 'conflicto'` **no puede aprobarse**: su única transición válida es a
`rechazada`, porque agregarla duplicaría una regla que el prompt ya contiene. El
`rejection_reason` queda como registro de que el bot desobedeció una regla existente.

### 5.4 `nlcn_prompt_versions`

Historial completo, restaurable.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `BIGSERIAL PK` | |
| `agent_key` | `TEXT NOT NULL` | |
| `version_number` | `INTEGER NOT NULL` | Incremental por agente |
| `system_prompt` | `TEXT NOT NULL` | **Snapshot del prompt resultante de esta versión** |
| `change_summary` | `TEXT` | "3 reglas integradas" / "Restaurado desde v4" |
| `rule_ids` | `JSONB` | Array de ids de `nlcn_learned_rules` que originaron esta versión |
| `created_by` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

`UNIQUE (agent_key, version_number)`.

**Semántica del snapshot:** cada fila guarda el prompt **resultante** de esa versión, no el
anterior. La migración crea la **versión 1** de cada agente con su `system_prompt` actual,
así ningún agente queda sin punto de retorno desde el primer día.

**Agentes creados después de la migración:** la semilla solo alcanza a los agentes que
existían al aplicarla. Para el resto, la función SQL **archiva el prompt vivo como versión 1
antes de crear la versión nueva**, dentro de la misma transacción. Sin eso, el primer cambio
de un agente nuevo guardaría el texto ya modificado como v1 y sería irreversible — el defecto
lo encontró la verificación de punta a punta y está corregido en la migración
`20260801010000_baseline_version_al_primer_cambio.sql`.

**Restaurar** = tomar el `system_prompt` de la versión X, escribirlo en `nlcn_agent_prompts`,
y crear una **versión nueva** con ese contenido (`change_summary = "Restaurado desde vX"`).
El historial nunca se reescribe ni se borra.

---

## 6. Detección de episodios y señales

### 6.1 El barrido

Corre en `app/api/cron/resumenes/route.ts` (y también bajo demanda, §8.4).

1. Buscar en `chatbot_logs` los `(phone, agente_usado)` cuyo mensaje más reciente tenga
   **≥ `REVIEW_IDLE_HOURS`** de antigüedad.
2. Para cada uno, traer sus logs y **partirlos en episodios** con la regla del hueco de 6h.
3. Descartar los episodios que ya tengan fila en `nlcn_conversation_reviews`
   (por `(phone, agente, window_end)`).
4. Para cada episodio pendiente: calcular señales → llamar a la IA para el resumen →
   insertar la fila.
5. Tope de **20 episodios por corrida** (`REVIEW_BATCH_SIZE`), para no chocar con el
   `maxDuration = 60` de Vercel. El resto queda para la siguiente.

### 6.2 Señales heurísticas

Se calculan **sin IA**, leyendo `chatbot_logs`. Son las que ordenan la bandeja.

| Señal | Condición | Peso |
|---|---|---|
| `escalamiento` | `agente_usado = 'escalamiento'` en algún turno | 40 |
| `error_bot` | `message_out` contiene el texto de fallback de error del chatbot | 40 |
| `no_procesable` | `agente_usado = 'sistema'` (audio/imagen no procesada) | 25 |
| `derivado_ventas` | `transferir_a_ventas = true` | 20 |
| `conversacion_larga` | `turn_count >= 8` | 15 |

`priority = suma de pesos + risk_score` (el `risk_score` lo devuelve la IA, 0–100).

El texto de fallback a detectar es el literal que hoy devuelve `runAgent` en
[`app/api/chatbot/route.ts`](../../../app/api/chatbot/route.ts) cuando Claude falla —
se extrae a una constante compartida para que la detección no dependa de copiar el string.

---

## 7. Las llamadas a la IA

### 7.1 Resumen del episodio

**Entrada:** el transcript del episodio (turnos `message_in` / `message_out` en orden),
más metadatos (agente, si tenía reserva, señales detectadas).

**Salida estructurada** (`output_config.format` con esquema JSON — la API garantiza la
forma, sin parseo frágil):

```json
{
  "summary": "string",
  "topics": ["string"],
  "outcome": "resuelto | sin_resolver | escalado | derivado_ventas | indeterminado",
  "risk_score": 0
}
```

**Modelo:** `claude-sonnet-5`. Sucesor directo del `claude-sonnet-4-6` que usa el proyecto
hoy, mismo rango de precio ($3 / $15 por millón de tokens; precio de lanzamiento $2 / $10
hasta el 2026-08-31).

### 7.2 Feedback → regla aprendida

**Entrada:** el transcript, el resumen, el comentario de la persona (global y/o anclado a
un mensaje), y **el `system_prompt` actual del agente**.

**Salida estructurada:**

```json
{
  "kind": "nueva | conflicto",
  "agent_key": "soporte | bigday | ventas",
  "trigger_text": "string",
  "rule_text": "string",
  "rationale": "string",
  "conflict_excerpt": "string | null"
}
```

**Por qué se le pasa el prompt actual.** Es la decisión de diseño más importante de esta
sección. Sin ella, el sistema infla el prompt con reglas repetidas hasta que se contradicen
entre sí — que es exactamente cómo se degradan estos sistemas con el tiempo. Con ella, la
IA distingue dos situaciones distintas:

- **`nueva`** → falta la regla. Se propone, en el estilo y el idioma del prompt existente.
- **`conflicto`** → la regla **ya existe** y el modelo cita la línea que la cubre. Eso
  significa que el bot desobedeció, que es un problema distinto (prompt confuso,
  contradicción con otra regla, o un caso que el modelo no reconoció). Aparece marcado
  aparte en la cola y **no puede aprobarse** — agregarla solo empeoraría el prompt.

**Modelo:** `claude-opus-5`. Es la decisión más delicada del sistema — leer un prompt largo,
detectar cobertura previa, y redactar en el mismo estilo — y corre pocas veces al día.
$5 / $25 por millón de tokens.

### 7.3 Consolidación de reglas aprobadas → prompt

Reusa el prompt de sistema de
[`prompt-assistant/merge`](../../../app/api/prompt-assistant/merge/route.ts), extendido
para aceptar **varias reglas de una sola vez** en lugar de un fragmento suelto. Devuelve el
`system_prompt` completo modificado. El diff se calcula en el cliente con `DiffView`.

**Modelo:** `claude-opus-5` (misma exigencia que 7.2).

### 7.4 Configuración de modelos

Hoy [`lib/anthropic.ts`](../../../lib/anthropic.ts) expone un único `ANTHROPIC_MODEL`
global que usa el chatbot en producción. Cambiarlo afectaría las respuestas a los huéspedes.
Se agregan dos variables independientes:

| Variable | Por defecto | Usada en |
|---|---|---|
| `ANTHROPIC_MODEL` | *(sin cambios)* | Chatbot en producción |
| `ANTHROPIC_REVIEW_MODEL` | `claude-sonnet-5` | Resúmenes (§7.1) |
| `ANTHROPIC_RULES_MODEL` | `claude-opus-5` | Reglas y merge (§7.2, §7.3) |

Puede hacer falta subir `@anthropic-ai/sdk` de `0.99.0` a la última versión para tener los
tipos de `output_config.format`.

---

## 8. Superficie de la aplicación

### 8.1 Módulos nuevos en `lib/`

Cada uno con un trabajo, testeable por separado:

| Archivo | Responsabilidad |
|---|---|
| `lib/conversation-episodes.ts` | Partir logs en episodios; calcular señales y prioridad. **Lógica pura, sin I/O.** |
| `lib/review-summary.ts` | Llamada a Claude para el resumen (§7.1). |
| `lib/learned-rules.ts` | Feedback → regla (§7.2); máquina de estados; consolidación de reglas aprobadas. |
| `lib/prompt-versions.ts` | Crear snapshot, aplicar cambio de forma atómica, restaurar. |

### 8.2 Rutas API nuevas

Todas protegidas con `requireUser()` de [`lib/api-auth.ts`](../../../lib/api-auth.ts),
salvo el cron.

| Ruta | Método | Qué hace |
|---|---|---|
| `/api/cron/resumenes` | `GET` | El barrido (§6.1). Se agrega a `vercel.json`. |
| `/api/reviews/refresh` | `POST` | Mismo motor que el cron, disparado a mano desde la bandeja. |
| `/api/reviews/[id]/feedback` | `POST` | Guarda calificación + comentario + anclajes; luego genera la regla candidata. |
| `/api/reviews/[id]/retry-rule` | `POST` | Reintenta solo la generación de la regla. |
| `/api/rules/[id]` | `PATCH` | Aprobar / editar y aprobar / rechazar (compuerta 1). |
| `/api/prompts/[agentKey]/prepare` | `POST` | Consolida las reglas aprobadas y devuelve el prompt propuesto (sin guardar). |
| `/api/prompts/[agentKey]/apply` | `POST` | Compuerta 2: guarda prompt + versión + marca reglas como aplicadas. |
| `/api/prompts/[agentKey]/restore` | `POST` | Restaura una versión. |

La lectura inicial de la bandeja se hace en el **server component** de `/revision`,
siguiendo el patrón de [`app/page.tsx`](../../../app/page.tsx).

### 8.3 Componentes nuevos

Ruta nueva `app/revision/page.tsx` (no un modal: el equipo va a pasar rato leyendo
transcripts, y eso no cabe cómodo en una ventanita). Cuatro componentes con un trabajo cada
uno, para que ninguno crezca como ya crecieron `AgentTester.tsx` (443 líneas) y
`PromptAssistant.tsx` (442):

| Componente | Contenido |
|---|---|
| `components/review/ReviewInbox.tsx` | Lista priorizada, filtros por estado y agente, botón "Actualizar bandeja". |
| `components/review/ReviewDetail.tsx` | Dos columnas: resumen de la IA / conversación real con marcado por mensaje. Calificación global + "¿qué debería haber hecho?". |
| `components/review/RulesQueue.tsx` | Compuerta 1: reglas propuestas en lenguaje llano, con aprobar / editar / rechazar, y los conflictos aparte. |
| `components/review/PromptApply.tsx` | Compuerta 2: diff con `DiffView`, botón aplicar, e historial de versiones con restaurar. |

### 8.4 La bandeja

Cada fila muestra: nombre del huésped (si hay reserva en `reservas_orbe`) o teléfono,
agente que atendió, fecha, chips de señal en color, el resumen en una línea y el estado.
Ordenada por `priority DESC`. Filtros por estado (`pendiente` / `revisada` / todas) y por
agente.

El botón **"Actualizar bandeja"** dispara `/api/reviews/refresh` — el mismo motor que el
cron — para no depender del reloj.

**Nota sobre el cron en Vercel:** el plan Hobby permite crons **una vez al día**. Para
correr cada hora hace falta plan Pro. El sistema funciona igual con corrida diaria: la
bandeja se llena una vez al día, y el botón manual cubre el resto.

---

## 9. Qué pasa al guardar el feedback

1. **La calificación siempre se guarda primero**, con comentario o sin él, y la revisión
   pasa a `revisada`. Esto solo ya alimenta las métricas: cuántas conversaciones buenas por
   semana, qué agente falla más, qué temas generan más escalamientos.
2. **Si hay comentario**, recién ahí se llama a la IA (§7.2) y se inserta la regla en
   estado `propuesta`.
3. Si la llamada a la IA falla, **el trabajo de la persona ya está guardado**. Aparece
   "Reintentar generar regla" (`/api/reviews/[id]/retry-rule`).

Este orden — guardar antes de llamar a la IA — es deliberado: ningún error de la IA puede
hacer que alguien pierda lo que escribió.

---

## 10. Manejo de errores

| Falla | Comportamiento |
|---|---|
| Resumen de un episodio | Se registra con `logWorkflowError` y el barrido sigue con el siguiente. El índice único garantiza que se reintente solo en la próxima corrida. Ningún episodio bloquea a los demás. |
| Generación de la regla | Calificación y comentario ya guardados (§9). Botón de reintento. |
| Consolidación / merge | No se escribe nada. Se muestra el error y se puede reintentar. |
| Aplicar al prompt | **Atómico**: se crea la versión, se actualiza `nlcn_agent_prompts` y se marcan las reglas como `aplicada` en una sola transacción (función SQL). O pasa todo o no pasa nada. |
| Cron se pasa de tiempo | Tope de `REVIEW_BATCH_SIZE` episodios por corrida; el resto queda para la siguiente. |

---

## 11. Pruebas

Con `vitest`, sin llamar a la IA ni a Supabase (las llamadas a Claude se simulan: se
verifica que el input se arma bien y que la respuesta se maneja bien).

**`lib/conversation-episodes.ts`** — lógica pura, es donde más valor tienen las pruebas:

- Un episodio simple (mensajes seguidos) → una sola ventana.
- Dos bloques separados por 7 horas → dos episodios independientes.
- Hueco de exactamente 6 horas → caso borde explícito.
- Conversación de un solo mensaje → episodio válido de un turno.
- Mensajes de dos agentes distintos con el mismo teléfono → episodios separados.

**Señales y prioridad:**

- Cada señal se dispara con el log que corresponde y solo con ese.
- La suma de pesos y el orden final de la bandeja son los esperados.
- Detección del texto de fallback vía la constante compartida, no un string copiado.

**Idempotencia:**

- Correr el barrido dos veces sobre los mismos datos no crea filas duplicadas.

**Máquina de estados de las reglas:**

- No se puede aplicar una regla `rechazada`.
- No se puede aprobar una regla ya `aplicada`.
- Una regla `kind = 'conflicto'` no se puede aprobar.

**Versiones de prompt:**

- Restaurar crea una versión nueva en vez de reescribir el historial.
- `version_number` es incremental y sin huecos por agente.

---

## 12. Costos

| Llamada | Modelo | Aproximado |
|---|---|---|
| Resumen de un episodio | `claude-sonnet-5` | ~1 centavo de dólar |
| Feedback → regla | `claude-opus-5` | ~4–5 centavos |
| Consolidación → prompt | `claude-opus-5` | ~4–5 centavos, pocas veces por semana |

Con 30 conversaciones diarias, resumir todas ronda los **10 dólares al mes**. El costo real
depende del volumen; los números de arriba son órdenes de magnitud para dimensionar, no una
factura.

---

## 13. Fuera de alcance (decidido, no olvidado)

- **Roles y permisos.** Cualquiera que entre al panel puede revisar y aprobar. Ya hay login
  con Supabase; agregar niveles de permiso es otra funcionalidad.
- **Notificaciones.** Nadie recibe correo diciendo "hay 5 conversaciones por revisar". La
  bandeja se mira al entrar al panel.
- **Reglas condicionales** por temporada o tipo de huésped. Una regla aplica a un agente y ya.
- **Inyección de reglas en tiempo de ejecución.** Se descartó a favor del flujo de dos
  compuertas: toda regla aprobada termina integrada al `system_prompt`, con su diff aprobado
  por una persona.
- **Gráficos y métricas históricas elaboradas.** Los datos se guardan desde el día uno, pero
  la primera versión muestra contadores básicos. Los gráficos vienen cuando haya suficientes
  semanas para que digan algo.
- **Resumen en tiempo real.** Se evaluó y se descartó: un request de Vercel no puede quedar
  esperando 6 horas al final de una conversación. El cron + el botón manual lo cubren.

---

## 14. Decisiones de diseño y su razón

| Decisión | Razón |
|---|---|
| Episodios por hueco de 6h en vez de "fin de conversación" | No existe un evento de fin en WhatsApp. El hueco es determinístico, idempotente y auditable. |
| Cron + botón manual, no procesamiento en vivo | Un request de Vercel muere al terminar; no puede esperar horas. El cron reintenta solo. |
| Todas las conversaciones se resumen, la bandeja prioriza | Resumir todo da métricas reales; priorizar evita que el equipo revise lo que llegó último en vez de lo que importa. |
| Calificación global **+** anclaje a mensaje puntual | El anclaje hace que la regla generada sea certera: la IA ve qué pregunta y qué respuesta fallaron. |
| Pasarle el prompt actual a la IA al generar la regla | Sin eso el prompt se infla con reglas duplicadas hasta contradecirse. Permite distinguir "falta la regla" de "el bot desobedeció". |
| Dos compuertas de aprobación | El humano decide dos veces: primero si la regla es correcta, después si el texto exacto que entra al prompt es correcto. |
| Reglas aprobadas se acumulan y se aplican juntas | Menos ediciones al prompt, menos duplicados, una sola decisión en vez de cinco. |
| Historial de versiones con restaurar | Sin él, cada cambio aprobado es irreversible en la práctica. Es la red de seguridad de todo el sistema. |
| Guardar el feedback humano **antes** de llamar a la IA | Ningún error de la IA puede hacer que alguien pierda lo que escribió. |
| Variables de modelo separadas del chatbot | Cambiar el modelo de los resúmenes no debe tocar las respuestas a los huéspedes. |
| Salida estructurada en vez de "devolveme un JSON" | La API garantiza la forma; no hay parseo frágil ni respuestas a medio formatear. |
| Ruta `/revision` en vez de otro modal | El equipo va a leer transcripts largos, y evita que `Dashboard.tsx` siga creciendo. |
