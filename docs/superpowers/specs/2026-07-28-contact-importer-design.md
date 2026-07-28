# Importador de contactos B2B → GoHighLevel

**Fecha:** 2026-07-28
**Proyecto:** nlcn-panel (Next.js 16 + Supabase + GHL)
**Estado:** Diseño aprobado, pendiente de plan de implementación

---

## 1. Qué es (en simple)

Una pestaña nueva en el panel — **"Importar contactos"** — donde el usuario sube un
archivo de prospectos (CSV o Excel), ve un resumen en español de lo que se va a
importar, y con un clic los crea en GoHighLevel (GHL) con sus etiquetas, una nota de
venta y una oportunidad en el pipeline.

**Experiencia del usuario, paso a paso:**

1. Entra al panel → pestaña **"Importar contactos"**.
2. **Arrastra el archivo** (CSV o XLSX; cualquiera de los dos).
3. En segundos ve un **resumen en español** + una **tabla de previsualización** de los
   contactos que se van a crear. Nada se ha tocado en GHL todavía.
4. Aprieta **"Confirmar e importar"**.
5. Cada prospecto queda en GHL con: datos de contacto, etiquetas, una nota de venta y
   una oportunidad como prospecto nuevo.
6. Ve un **reporte final**: "X creados, Y ya existían y se actualizaron, Z omitidos".

Es un flujo **subir → revisar → confirmar**. Un clic para importar.

---

## 2. Los archivos de origen

Ambos archivos entregados son **el mismo lote** ("Toronto Gateway Batch 1"), 20
prospectos (agencias de viaje B2B en la zona de Toronto para Natural Lodge Caño Negro),
en dos formatos:

### 2.1 CSV — `br_alto_import_contacts_*.csv` (fuente canónica de importación)
Ya viene con forma de CRM. 29 columnas fijas:

```
First Name, Last Name, Company Name, Email, Phone, Website, City, State/Province,
Country, Lead Source, Tags, Pipeline, Stage, Lead Score, Priority, Lead Type,
Pitch Angle, Contact Method, Best Contact URL, Direct Email Found, Phone Found,
Button Sweep, Instagram, Facebook, LinkedIn, Market Reach, Activity Level,
Content Fit, Notes
```

Particularidades a manejar:
- **Tags** viene como un solo string entre comillas, separado por comas:
  `"B2B-Agent, Travel-Advisor, Canada, Toronto-Gateway, Priority-A, ..."`.
  Hay que partir por coma y limpiar espacios.
- **Pipeline** = `Travel Agency Partnerships`, **Stage** = `New Prospect`
  (coinciden con la oportunidad a crear en GHL).
- **Notes** empaqueta dos cosas separadas por ` | ` (nota de fit + primera acción).
- **Muchas filas no traen Email ni Phone** (solo web/redes + tag `Manual-Button-Check`).

### 2.2 XLSX — `..._team_manual.xlsx` (libro de trabajo del equipo)
8 hojas. La relevante para importar es **"Manual Leads"** (42 columnas): los mismos 20
leads con más inteligencia y, de forma importante, un **Lead ID estable `TOR-001…TOR-020`**
que el CSV **no** tiene. Las demás hojas (Dashboard, Outreach Tracker, Email Templates,
Search Protocol, Scoring Criteria, Sources, City Queue) son metodología/seguimiento y
**no** se importan.

Cuando el usuario suba un XLSX, se lee **solo la hoja "Manual Leads"**.

### 2.3 Supuesto de columnas fijas
El usuario confirma que las columnas **siempre serán las mismas**. Por eso el mapeo
columna→GHL es **determinista (código)**, no lo decide un modelo. Claude se usa solo
para validar/resumir (ver §5).

---

## 3. Arquitectura

Una sola ruta API con **dos modos**: `dryRun` (previsualiza, no toca GHL) y real
(ejecuta). Piezas pequeñas, cada una con una responsabilidad y testeable por separado.

```
Panel (pestaña "Importar contactos")
        │  sube archivo (multipart/form-data)
        ▼
POST /api/contacts/import?dryRun=1  ──► Previsualización (NO toca GHL)
        │  usuario confirma
        ▼
POST /api/contacts/import           ──► Crea en GHL + reporte final
```

### Módulos

| Módulo | Responsabilidad única |
|---|---|
| `lib/prospect-parser.ts` | Recibe el archivo, detecta CSV vs XLSX, devuelve `RawProspect[]` normalizado. Para XLSX lee la hoja *Manual Leads*. Usa **SheetJS (`xlsx`)** (lee ambos formatos con una sola dependencia). |
| `lib/prospect-mapper.ts` | `RawProspect` → payloads de GHL (contacto, tags, nota, custom fields, oportunidad). Función pura, sin I/O. |
| `lib/prospect-validator.ts` | Reglas deterministas: email válido, ¿tiene canal de contacto?, requeridos. Marca `warnings[]` por fila. |
| `lib/prospect-summary.ts` | Llama a Claude con las métricas del lote ya calculadas; devuelve un resumen en español + alertas. |
| `lib/ghl.ts` (extender) | Agregar `createNote`, `createOpportunity`, `getPipelines`, `getCustomFields`, `findContactByFingerprint`; enriquecer `upsertContact` (name, company, website, city, state, country, source). |
| `app/api/contacts/import/route.ts` | Orquesta: auth → parse → validate → (dryRun: summary y responde / real: dedup + upsert + tags + note + customFields + opportunity) → reporte. |
| `components/ContactImport.tsx` | UI: dropzone, tabla de previsualización, confirmar, reporte. Se monta como pestaña en `Dashboard.tsx`. |

### Modelo interno único (`RawProspect`)
Aísla al resto del sistema de si vino de CSV o XLSX:

```
firstName, lastName, company, email, phone, website,
city, state, country, source, tagsRaw, pipeline, stage,
leadScore, priority, leadType, pitchAngle, contactMethod,
bestContactUrl, instagram, facebook, linkedin,
marketReach, activityLevel, contentFit, notes, leadId?
```
`leadId` solo existe si vino del XLSX; se usa para dedup y como custom field.

---

## 4. Mapeo a GoHighLevel

Por cada prospecto se realizan hasta 5 acciones:

**① Contacto** (`upsertContact` extendido):
firstName, lastName, name/companyName, email, phone, website, city, state, country,
source (= Lead Source). email/phone pueden ir vacíos.

**② Tags** (`addContactTags`): la columna Tags partida por coma y limpiada. Más:
- `Import-<Batch>` (ej. `Import-Toronto-Gateway-Batch1`) → permite filtrar/borrar el
  lote entero en GHL si algo sale mal. El `<Batch>` se deriva del Lead Source.
- `Contacto-Pendiente` **solo** si la fila no trae email ni teléfono.

**③ Nota** (`createNote`, nueva): texto legible con Prioridad, Score, Tipo, Pitch Angle,
acción sugerida (de Notes/Contact Method), redes, y — si vino del XLSX — Nature Fit,
evidencia y confidence.

**④ Custom Fields**: Lead Score, Priority, Lead Type, Pitch Angle, Market Reach,
Activity Level, Content Fit, Best Contact URL, y Lead ID (si XLSX). Ver §4.1.

**⑤ Oportunidad** (`createOpportunity`, nueva): pipeline `Travel Agency Partnerships`,
etapa `New Prospect`, nombre = empresa/asesor, status `open`, monto 0, ligada al contacto.

### 4.1 Descubrimiento de IDs (pipeline, etapa, custom fields)
La API de GHL requiere IDs internos, no nombres. Al ejecutar, el sistema consulta
`GET /opportunities/pipelines` y `GET /custom-fields`, hace *match por nombre* con lo que
pide el archivo, y cachea el mapa. **Degradación elegante:** si un custom field o el
pipeline/etapa no existe en GHL, el import **no se rompe** — crea lo que sí puede
(contacto + tags + nota; y oportunidad si el pipeline existe) y **reporta en el resumen**
qué no pudo llenarse, para que el usuario decida si crea esos campos en GHL. Cero
configuración manual requerida.

---

## 5. Rol de Claude

Mapeo = código determinista. Claude interviene **solo** en la previsualización, para
darle valor al usuario sin costo por fila:

- **Entrada:** métricas del lote ya calculadas por código (totales, cuántos con/sin
  contacto, duplicados detectados, warnings de validación) + una muestra de filas
  problemáticas.
- **Salida:** un párrafo de resumen en español + lista de alertas accionables
  ("3 correos con formato inválido", "5 posibles duplicados ya en GHL").

Una sola llamada a Claude por previsualización (no por fila). Usa `lib/anthropic.ts`
(`ANTHROPIC_MODEL`). Si la llamada a Claude falla, la previsualización **igual funciona**
con el resumen calculado por código (Claude es un extra, no un bloqueante).

---

## 6. Deduplicación

Objetivo del usuario: **evitar duplicados** al reimportar un lote o uno que solape con
contactos ya en GHL.

Estrategia por prospecto:
1. **Si trae email o teléfono** → `upsertContact` de GHL ya deduplica por ellos
   (actualiza en vez de crear, y se agregan tags).
2. **Si NO trae ninguno** → se construye una **huella `firstName+lastName+company`**
   (normalizada: minúsculas, sin acentos, sin espacios extra). Se busca en GHL
   (`findContactByFingerprint`, best-effort por nombre + match de empresa del lado del
   servidor). Si existe, se actualiza y se agregan tags; si no, se crea.
3. Si vino del XLSX, el **Lead ID** se guarda como custom field y refuerza la huella.

El reporte final distingue **creados** vs **actualizados (ya existían)**.

---

## 7. Contactos sin canal de contacto

Decisión del usuario: **crearlos igual, marcados.** Los prospectos sin email ni teléfono
se crean en GHL con nombre + empresa + web/redes + tag `Contacto-Pendiente`, para que el
equipo consiga los datos después. No se pierde ningún prospecto. La previsualización los
cuenta aparte ("15 sin datos de contacto → quedarán marcados").

---

## 8. Manejo de errores y reporte

- **Parseo:** si el archivo no es CSV/XLSX válido, o le faltan columnas esperadas →
  error claro en la UI antes de tocar GHL ("El archivo no tiene las columnas esperadas:
  falta X").
- **Por fila en la ejecución:** cada prospecto se procesa de forma independiente con
  reintentos (reusar `withRetry` de `lib/ghl.ts`). Si un contacto falla, **no aborta el
  lote**: se registra en el reporte como fallido con la razón, y el resto continúa.
- **Idempotencia:** gracias al dedup (§6), reejecutar el mismo archivo no duplica.
- **Reporte final** (JSON → UI): `{ creados, actualizados, omitidos, fallidos[] }` con
  motivo por cada fallido y lista de custom fields que no existían en GHL.
- **Auth:** la ruta usa `requireUser()` (`lib/api-auth.ts`), igual que el resto del panel.
  `middleware.ts` ya protege el panel; esta ruta vive bajo la sesión del panel (no es un
  webhook público).

---

## 9. Alcance y no-alcance

**Incluye:**
- Pestaña de importación en el panel.
- Parseo CSV + XLSX (hoja Manual Leads).
- Previsualización con resumen (Claude) + tabla.
- Creación en GHL: contacto + tags + nota + custom fields + oportunidad.
- Dedup y contactos sin canal marcados.
- Reporte de resultados.

**No incluye (YAGNI, por ahora):**
- Importación en segundo plano por cron (el volumen es ~20 filas; el flujo síncrono
  basta).
- Redacción automática de correos personalizados por contacto (las plantillas del XLSX
  quedan como referencia; se puede agregar después).
- Edición de contactos dentro de la tabla de previsualización (solo confirmar/cancelar).
- Soporte de otros formatos de archivo o esquemas de columnas distintos.

---

## 10. Pruebas

- **Parser:** CSV y XLSX de ejemplo (los dos archivos reales del repo) → `RawProspect[]`
  esperado; casos con tags entre comillas, filas sin email/phone, Notes con ` | `.
- **Mapper:** `RawProspect` → payloads correctos (tags parseados, nota armada, batch tag).
- **Validator:** emails inválidos, filas sin canal, requeridos faltantes.
- **Dedup:** huella normalizada estable ante mayúsculas/acentos/espacios.
- **Ruta (dryRun):** no llama a GHL; devuelve resumen + previsualización.
- **Ruta (real):** con GHL mockeado, verifica orden de llamadas y que un fallo por fila
  no aborta el lote.
