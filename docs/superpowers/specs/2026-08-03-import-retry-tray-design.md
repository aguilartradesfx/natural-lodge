# Bandeja de reintento + pestaña propia del importador

**Fecha:** 2026-08-03
**Proyecto:** nlcn-panel (Next.js 16 + Supabase + GHL)
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Extiende:** [2026-07-28-contact-importer-design.md](2026-07-28-contact-importer-design.md)

---

## 1. Qué es (en simple)

Hoy, cuando importas prospectos, las filas que **rebotan** (errores de GHL/Bralto)
aparecen en un reporte de solo lectura. Este cambio las convierte en **tarjetas
editables**: ves el motivo exacto del error en español, corriges el correo o el
teléfono (o eliges cuál conservar), le das **Reintentar**, y las que entran
desaparecen de la lista. Puedes repetir el ciclo hasta que pase todo.

Además, todo el importador se mueve de un **modal** a su **propia página**
(`/importar`) para tener espacio.

**Contexto del problema (por qué):** los workbooks del cliente reúsan el mismo
teléfono de agencia en varios asesores, y la cuenta de GHL tiene
`allowDuplicateContact: false` con `contactUniqueIdentifiers: [email, phone]` —
así que dos contactos no pueden compartir teléfono ni correo. La bandeja de
reintento le da al usuario el control para resolver esos choques sin salir del
panel.

---

## 2. Alcance

**Incluye:**
1. Mover el importador de un `<Modal>` a una **página propia** `/importar`
   (ruta protegida por login), enlazada desde el header.
2. En la sección de resultados, **bandeja de reintento** con filas editables.
3. Por cada fila con error: **pista de error en español** + edición de
   **correo** y **teléfono** + dos acciones rápidas: **"Mantener correo"**
   (quita el teléfono) y **"Mantener teléfono"** (quita el correo).
4. Botón **"Reintentar (N)"**: reenvía las filas corregidas; las que entran se
   quitan; las que siguen fallando se quedan con su nuevo motivo. Ciclo
   repetible.
5. Refactor: extraer el "motor" de importación a `lib/prospect-importer.ts`
   para que la ruta de archivo y la de reintento compartan la misma lógica.

**No incluye (YAGNI):**
- Editar campos distintos a correo/teléfono (nombre, empresa, etc. quedan como
  vienen del archivo).
- Persistir la sesión de importación en base de datos (todo vive en memoria del
  navegador mientras el modal/página está abierto).
- Reintentos automáticos sin intervención del usuario.
- Cambiar el nombre visible: sigue diciendo **"Bralto"**.

---

## 3. Arquitectura

### 3.1 Refactor: motor de importación compartido
La lógica de importación (resolver IDs de pipeline/campos, deduplicar por
email→teléfono→huella, crear/actualizar contacto, tags, nota, oportunidad,
acumular reporte) hoy vive **dentro** de `app/api/contacts/import/route.ts`.
Se extrae a un módulo puro-de-orquestación:

`lib/prospect-importer.ts`
- `importProspects(mapped: MappedProspect[]): Promise<ImportReport>` — el motor.
- `findExisting(m: MappedProspect): Promise<GhlContact | null>` — dedup (se
  mueve aquí desde la ruta, sin cambios de lógica).
- Reusa los helpers de `lib/ghl.ts` (search/create/update/note/opportunity/…).

Ambas rutas quedan delgadas y llaman a `importProspects`.

### 3.2 Rutas
- `app/api/contacts/import/route.ts` (existente): auth → parse archivo →
  validar → mapear → `importProspects` → responder. **Cambio:** enriquecer las
  filas fallidas del reporte (ver §4).
- `app/api/contacts/import/retry/route.ts` (**nueva**): auth → recibe
  `{ batchTag: string, rows: RawProspect[] }` (JSON) → mapea con `mapProspect` →
  `importProspects` → responde con un reporte del mismo shape.

### 3.3 Página
- `app/importar/page.tsx` (**nueva**): página protegida (Server Component que
  verifica sesión, como `app/page.tsx`) que renderiza `<ContactImport />` a
  ancho completo, con un encabezado propio (título + enlace "← Volver al panel"
  + cerrar sesión), consistente con el tema oscuro/glass.
- `components/Dashboard.tsx` (**modificar**): quitar el estado `importOpen` y el
  `<Modal>` de importación.
- `components/AppHeader.tsx` (**modificar**): el pill "Importar contactos" pasa
  de `onOpenImport` (abre modal) a un enlace de navegación (`next/link`) hacia
  `/importar`.

---

## 4. Cambios en el reporte (data flow)

El reporte de importación (`ImportReport`) cambia sus entradas fallidas para
que el navegador pueda editar y reintentar:

```
type FailedRow = {
  rowNumber: number;
  name: string;
  reason: string;      // mensaje crudo de GHL (detalle)
  hint: string;        // pista accionable en español (ver §5)
  matchingField?: 'phone' | 'email'; // si el error fue por duplicado, cuál campo
  raw: RawProspect;    // datos completos de la fila, para editar + reintentar
};

type ImportReport = {
  created: number;
  updated: number;
  failed: FailedRow[];
  missingCustomFields: string[];
  pipelineResolved: boolean;
};
```

`created`/`updated` son los de **esa** llamada. El navegador **acumula** los
totales entre la importación inicial y los reintentos (ver §6).

La respuesta (archivo y retry) incluye además `batchTag` para que el reintento
mantenga la misma etiqueta de lote:
`{ ok: true, report: ImportReport, batchTag: string }`.

---

## 5. Pistas de error en español

Server-side, al capturar un error de fila, se calcula `hint` y (si aplica)
`matchingField` a partir del error de GHL:

| Error GHL | matchingField | hint |
|---|---|---|
| `does not allow duplicated contacts` (meta.matchingField = phone) | `phone` | "Ya existe un contacto con ese teléfono (línea de agencia compartida). Quita el teléfono o pon uno propio." |
| `does not allow duplicated contacts` (meta.matchingField = email) | `email` | "Ya existe un contacto con ese correo." |
| `too long to be a phone number` | — | "El teléfono no es válido. Corrígelo o quítalo." |
| cualquier otro | — | (se muestra `reason` tal cual) |

Función pura `explainGhlError(reason: string): { hint: string; matchingField?: 'phone' | 'email' }`
en `lib/prospect-importer.ts` (o un archivo hermano), testeable por separado.
El parseo lee el JSON del cuerpo del `GhlError` cuando existe.

---

## 6. Interfaz (`components/ContactImport.tsx`)

La fase de **resultados** (`done`) pasa de solo-lectura a interactiva:

```
✅ Importación completa
   3 creados · 6 actualizados · 7 con error        [ Reintentar (7) ]

  ┌──────────────────────────────────────────────────────────────┐
  │ Ron Geddert — Travel Best Bets                                │
  │ ⚠ Ya existe un contacto con ese teléfono (línea compartida).   │
  │   Quita el teléfono o pon uno propio.                          │
  │   Correo:  [ __________________ ]                             │
  │   Teléfono:[ 604-669-6607_______ ]                            │
  │   [ Mantener correo ]  [ Mantener teléfono ]                  │
  └──────────────────────────────────────────────────────────────┘
```

**Estado del componente:**
- `failedRows: FailedRow[]` — filas con error, editables (se guarda el `raw`).
- Editar el input de correo/teléfono muta `raw.email` / `raw.phone` de esa fila.
- **"Mantener correo"** → `raw.phone = ''`. **"Mantener teléfono"** → `raw.email = ''`.
- `totals: { created, updated }` — acumulado mostrado arriba.

**Reintentar (N):**
1. `POST /api/contacts/import/retry` con `{ batchTag, rows: failedRows.map(f => f.raw) }`.
2. Con el reporte nuevo: `totals.created += report.created`,
   `totals.updated += report.updated`; **reemplazar** `failedRows` por
   `report.failed` (las que entraron ya no vienen; las que siguen mal traen su
   nuevo `hint`/`raw`).
3. Si `report.failed` queda vacío → mensaje "¡Todo cargado!".

Botón deshabilitado mientras reintenta (spinner "Reintentando…"). Errores de
red se muestran sin perder las ediciones.

**Página:** el componente se monta en `/importar` a ancho completo; la fase de
dropzone/preview es la misma que hoy, solo con más espacio.

---

## 7. Manejo de errores

- El motor sigue aislando fallos **por fila** (un rebote no aborta el lote);
  cada fila fallida ahora se enriquece con `hint`/`raw`/`matchingField`.
- La ruta de retry valida el body: si `rows` no es un arreglo no vacío → 400 con
  mensaje en español. Límite defensivo de tamaño (p. ej. ≤ 500 filas) para no
  abusar.
- Auth: ambas rutas y la página usan la sesión (`requireUser` / verificación en
  el Server Component), igual que el resto del panel.
- "Mantener correo" cuando la fila no tiene correo dejaría al contacto sin
  correo **ni** teléfono → se crea igual (contacto por nombre, con
  `Contacto-Pendiente`); no rebota por duplicado. Esto es aceptable y esperado.

---

## 8. Pruebas

- **`explainGhlError`**: mapea los 3 casos conocidos + fallback; extrae
  `matchingField` del JSON de meta.
- **`importProspects` (motor extraído)**: crea/actualiza, dedup por
  email/teléfono/huella, un fallo por fila no aborta, filas fallidas traen
  `raw`/`hint`. (Reusa/mueve los tests actuales de la ruta.)
- **Ruta `/retry`**: fila con `phone` quitado → ahora se crea (sin choque);
  fila que sigue con correo duplicado → vuelve en `failed` con su `hint`; body
  inválido → 400.
- **UI**: verificación manual en `/importar` (subir → confirmar → editar una
  fila → "Mantener correo" → Reintentar → la fila desaparece y suben los
  totales). Build + tsc limpios.
