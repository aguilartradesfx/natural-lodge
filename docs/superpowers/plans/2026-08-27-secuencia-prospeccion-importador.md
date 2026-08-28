# Conectar el importador con la secuencia de correos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el importador ponga la etiqueta que dispara la secuencia de correos de GHL solo en filas seguras, y que las filas repetidas dejen de sobrescribirse en silencio y pasen a una bandeja de revisión.

**Architecture:** Todo el cambio de lógica vive en `lib/prospect-importer.ts`, que gana un parámetro de opciones. Las dos rutas existentes solo le pasan esas opciones. La interfaz gana una casilla en la previsualización y una bandeja nueva, extraída a su propio componente para no engordar `ContactImport.tsx`.

**Tech Stack:** Next.js 16 (App Router), TypeScript, React 19, Vitest, Tailwind, GHL REST API v2.

**Spec:** [docs/superpowers/specs/2026-08-27-secuencia-prospeccion-importador-design.md](../specs/2026-08-27-secuencia-prospeccion-importador-design.md)

## Global Constraints

- Etiqueta que dispara la secuencia, exacta: `secuencia-prospeccion`
- Etiqueta de cuarentena, exacta: `duplicado-revisar`
- La casilla "Iniciar la secuencia de correos con este lote" va **desmarcada por defecto**. `startSequence` por defecto es `false` en el motor y en las rutas.
- Una fila **sin correo nunca** recibe `secuencia-prospeccion`, aunque la casilla esté marcada.
- Una fila que ya existe en GHL **nunca** recibe `secuencia-prospeccion`.
- `GhlContact` solo trae `firstName`, `lastName`, `companyName`, `email`, `phone` (más `id`/`tags`). La comparación de diferencias se limita a esos cinco campos: no hay datos para comparar más.
- Textos de interfaz en español, tuteo, igual que el resto del panel.
- Correr pruebas con `npm test`.
- No cambiar la lógica interna de `findExisting`: otros specs dependen de su comportamiento.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `lib/prospect-importer.ts` | Motor: opciones, tipo `DuplicateRow`, reglas de etiquetado | Modificar |
| `lib/prospect-importer.test.ts` | Pruebas del motor | Modificar |
| `app/api/contacts/import/route.ts` | Lee `startSequence` del form | Modificar |
| `app/api/contacts/import/retry/route.ts` | Acepta `mode` | Modificar |
| `components/import/DuplicateTray.tsx` | Bandeja de duplicados (presentacional) | Crear |
| `components/ContactImport.tsx` | Casilla + estado de duplicados + monta la bandeja | Modificar |

`DuplicateTray` se extrae porque `ContactImport.tsx` ya tiene 346 líneas y la bandeja nueva sumaría ~90. Sigue el patrón de `components/review/`.

---

## Task 1: Motor — reportar duplicados sin sobrescribir

**Files:**
- Modify: `lib/prospect-importer.ts:10-25` (tipos), `lib/prospect-importer.ts:89-178` (motor)
- Test: `lib/prospect-importer.test.ts`

**Interfaces:**
- Produces: `type DuplicateRow`, `type ImportOptions`, `ImportReport.duplicates: DuplicateRow[]`, `importProspects(mapped, options?: ImportOptions)`
- Consumes: `findExisting`, `GhlContact`, `MappedProspect` (existentes)

- [ ] **Step 1: Escribir la prueba que falla**

En `lib/prospect-importer.test.ts`, dentro de `describe('importProspects')`:

```ts
it('no sobrescribe cuando ya existe: lo reporta como duplicado', async () => {
  vi.mocked(ghl.searchContacts).mockResolvedValue([
    { id: 'x1', email: 'a@b.com', firstName: 'Ana', lastName: 'Pérez', companyName: 'Otra Empresa' },
  ] as never);
  const r = await importProspects(mapped({ email: 'a@b.com' }));
  expect(ghl.updateContact).not.toHaveBeenCalled();
  expect(ghl.createContact).not.toHaveBeenCalled();
  expect(r.updated).toBe(0);
  expect(r.duplicates).toHaveLength(1);
  expect(r.duplicates[0].existingId).toBe('x1');
  expect(r.duplicates[0].matchedBy).toBe('email');
  expect(r.duplicates[0].differingFields).toContain('companyName');
  expect(r.duplicates[0].differingFields).not.toContain('email');
});

it('si la búsqueda de duplicados falla, la fila no se crea: cae en failed', async () => {
  vi.mocked(ghl.searchContacts).mockRejectedValue(new Error('GHL 403 rate limit'));
  const r = await importProspects(mapped({ email: 'a@b.com' }));
  expect(ghl.createContact).not.toHaveBeenCalled();
  expect(r.created).toBe(0);
  expect(r.failed).toHaveLength(1);
  expect(r.failed[0].rowNumber).toBe(1);
});
```

> La segunda prueba debería pasar sin tocar nada: `findExisting` ya vive dentro
> del `try` del bucle, así que una excepción cae en `failed[]`. Se agrega para
> dejar ese comportamiento fijado — crear a ciegas cuando la búsqueda falla es
> exactamente el error que este cambio busca evitar.

- [ ] **Step 2: Correr las pruebas y verificar que la primera falla**

Run: `npm test -- lib/prospect-importer.test.ts -t "no sobrescribe"`
Expected: FAIL — `r.duplicates` es `undefined`.

- [ ] **Step 3: Agregar los tipos**

En `lib/prospect-importer.ts`, después de `FailedRow` (línea 17):

```ts
export type DuplicateRow = {
  rowNumber: number;
  name: string;
  company: string;
  matchedBy: 'email' | 'phone' | 'fingerprint';
  existingId: string;
  incoming: Record<string, string>;
  existing: Record<string, string>;
  differingFields: string[];
  raw: RawProspect;
};

export type ImportOptions = {
  /** Agrega `secuencia-prospeccion` a las filas nuevas con correo. */
  startSequence?: boolean;
  /** 'report' (default) no escribe nada; 'update' actualiza y marca para revisión. */
  onDuplicate?: 'report' | 'update';
};
```

Y en `ImportReport`, agregar el campo:

```ts
  duplicates: DuplicateRow[];
```

- [ ] **Step 4: Agregar el constructor de la fila duplicada**

En `lib/prospect-importer.ts`, justo después de `findExisting`:

```ts
const COMPARABLE = ['firstName', 'lastName', 'companyName', 'email', 'phone'] as const;
const digits = (s: string) => s.replace(/\D/g, '').slice(-10);

/** Arma la fila de revisión comparando el archivo contra lo que hay en GHL. */
export function buildDuplicateRow(m: MappedProspect, existing: GhlContact): DuplicateRow {
  const incoming: Record<string, string> = {};
  const current: Record<string, string> = {};
  const differingFields: string[] = [];

  for (const f of COMPARABLE) {
    const a = (m.contact[f] || '').trim();
    const b = (existing[f] || '').trim();
    incoming[f] = a;
    current[f] = b;
    if (a && a.toLowerCase() !== b.toLowerCase()) differingFields.push(f);
  }

  const sameEmail =
    Boolean(m.contact.email) &&
    (existing.email || '').toLowerCase() === m.contact.email.toLowerCase();
  const samePhone =
    Boolean(m.contact.phone) && digits(existing.phone || '') === digits(m.contact.phone);

  return {
    rowNumber: m.raw.rowNumber,
    name: m.contact.name,
    company: m.contact.companyName,
    matchedBy: sameEmail ? 'email' : samePhone ? 'phone' : 'fingerprint',
    existingId: existing.id,
    incoming,
    existing: current,
    differingFields,
    raw: m.raw,
  };
}
```

- [ ] **Step 5: Ramificar el motor**

En `importProspects`, cambiar la firma y el inicializador del reporte:

```ts
export async function importProspects(
  mapped: MappedProspect[],
  options: ImportOptions = {},
): Promise<ImportReport> {
  const onDuplicate = options.onDuplicate ?? 'report';
  const report: ImportReport = {
    created: 0,
    updated: 0,
    failed: [],
    duplicates: [],
    missingCustomFields: [],
    pipelineResolved: false,
  };
```

Dentro del `for`, reemplazar el bloque que hoy dice `const existing = await findExisting(m);` y su `if (existing) { … }` por:

```ts
      const existing = await findExisting(m);
      if (existing && onDuplicate === 'report') {
        report.duplicates.push(buildDuplicateRow(m, existing));
        continue;
      }

      let contactId: string;
      let outcome: 'created' | 'updated';
      if (existing) {
        const c = await updateContact(existing.id, fields);
        contactId = c.id;
        outcome = 'updated';
      } else {
        const c = await createContact(fields);
        contactId = c.id;
        outcome = 'created';
      }
```

- [ ] **Step 6: Correr la prueba y verificar que pasa**

Run: `npm test -- lib/prospect-importer.test.ts`
Expected: PASS. La prueba existente `'actualiza cuando ya existe (por correo)'` ahora **falla** — es correcto, cambió el comportamiento por defecto. Actualizarla para que pase `{ onDuplicate: 'update' }`:

```ts
  it('actualiza cuando ya existe y se pide explícitamente', async () => {
    vi.mocked(ghl.searchContacts).mockResolvedValue([{ id: 'x1', email: 'a@b.com' }] as never);
    const r = await importProspects(mapped({ email: 'a@b.com' }), { onDuplicate: 'update' });
    expect(ghl.updateContact).toHaveBeenCalled();
    expect(r.updated).toBe(1);
  });
```

Volver a correr: `npm test -- lib/prospect-importer.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/prospect-importer.ts lib/prospect-importer.test.ts
git commit -m "feat(importador): reportar duplicados en vez de sobrescribirlos"
```

---

## Task 2: Motor — reglas de etiquetado

**Files:**
- Modify: `lib/prospect-importer.ts` (constantes nuevas + bloque de etiquetas del motor)
- Test: `lib/prospect-importer.test.ts`

**Interfaces:**
- Consumes: `ImportOptions.startSequence`, `ImportOptions.onDuplicate` (Task 1)
- Produces: `SEQUENCE_TAG`, `DUPLICATE_TAG` exportadas

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
describe('reglas de etiquetado', () => {
  const tagsUsados = () => vi.mocked(ghl.addContactTags).mock.calls[0][1];

  it('fila nueva con correo y startSequence → lleva la etiqueta de secuencia', async () => {
    await importProspects(mapped({ email: 'a@b.com' }), { startSequence: true });
    expect(tagsUsados()).toContain('secuencia-prospeccion');
  });

  it('fila nueva con correo sin startSequence → no la lleva', async () => {
    await importProspects(mapped({ email: 'a@b.com' }));
    expect(tagsUsados()).not.toContain('secuencia-prospeccion');
  });

  it('fila SIN correo con startSequence → no la lleva', async () => {
    await importProspects(mapped({ email: '', phone: '+50688881111' }), { startSequence: true });
    expect(tagsUsados()).not.toContain('secuencia-prospeccion');
  });

  it('duplicado con onDuplicate update → lleva duplicado-revisar y NO la de secuencia', async () => {
    vi.mocked(ghl.searchContacts).mockResolvedValue([{ id: 'x1', email: 'a@b.com' }] as never);
    await importProspects(mapped({ email: 'a@b.com' }), {
      startSequence: true,
      onDuplicate: 'update',
    });
    expect(tagsUsados()).toContain('duplicado-revisar');
    expect(tagsUsados()).not.toContain('secuencia-prospeccion');
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- lib/prospect-importer.test.ts -t "reglas de etiquetado"`
Expected: FAIL — ninguna etiqueta nueva se agrega todavía.

- [ ] **Step 3: Agregar las constantes**

En `lib/prospect-importer.ts`, arriba de `explainGhlError`:

```ts
/** Etiqueta que dispara el workflow "Prospección · Secuencia de 4 correos" en GHL. */
export const SEQUENCE_TAG = 'secuencia-prospeccion';
/** Etiqueta de cuarentena: dispara "Prospección · Duplicados por revisar". */
export const DUPLICATE_TAG = 'duplicado-revisar';
```

- [ ] **Step 4: Aplicar las reglas en el motor**

Reemplazar la línea `if (m.tags.length) await addContactTags(contactId, m.tags);` por:

```ts
      const tags = [...m.tags];
      if (outcome === 'updated') {
        tags.push(DUPLICATE_TAG);
      } else if (options.startSequence && m.contact.email) {
        tags.push(SEQUENCE_TAG);
      }
      if (tags.length) await addContactTags(contactId, tags);
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `npm test -- lib/prospect-importer.test.ts`
Expected: PASS, toda la suite.

- [ ] **Step 6: Commit**

```bash
git add lib/prospect-importer.ts lib/prospect-importer.test.ts
git commit -m "feat(importador): etiquetar la secuencia solo en filas nuevas con correo"
```

---

## Task 3: Rutas — pasar las opciones

**Files:**
- Modify: `app/api/contacts/import/route.ts:28-29` y la llamada a `importProspects`
- Modify: `app/api/contacts/import/retry/route.ts`
- Test: `app/api/contacts/import/route.test.ts`

**Interfaces:**
- Consumes: `importProspects(mapped, options)` (Tasks 1-2)
- Produces: el form acepta `startSequence=1`; el JSON de retry acepta `mode: 'normal' | 'forceUpdate'`

- [ ] **Step 1: Escribir la prueba que falla**

`route.test.ts` **no** mockea `@/lib/prospect-importer` — corre el motor real
contra un `@/lib/ghl` mockeado. Así que la prueba se hace por el efecto
observable: qué etiquetas terminaron en `addContactTags`.

Primero, extender el helper `req()` (línea ~27) para aceptar la bandera:

```ts
function req(fileName: string, dryRun: boolean, startSequence = false): Request {
  const buf = readFileSync(path.resolve(import.meta.dirname, '../../../../tests/fixtures', fileName));
  const form = new FormData();
  form.set('file', new File([buf], fileName));
  if (startSequence) form.set('startSequence', '1');
  const url = `http://t/api/contacts/import${dryRun ? '?dryRun=1' : ''}`;
  return new Request(url, { method: 'POST', body: form });
}
```

Y luego, dentro de `describe('POST /api/contacts/import')`:

```ts
it('sin startSequence no pone la etiqueta que dispara los correos', async () => {
  const { POST } = await import('./route');
  await POST(req('prospects.csv', false));
  const todas = ghl.addContactTags.mock.calls.flatMap((c) => c[1] as string[]);
  expect(todas).not.toContain('secuencia-prospeccion');
});

it('con startSequence la pone solo en las filas con correo', async () => {
  const { POST } = await import('./route');
  const res = await POST(req('prospects.csv', false, true));
  const body = await res.json();
  const conEtiqueta = ghl.addContactTags.mock.calls.filter((c) =>
    (c[1] as string[]).includes('secuencia-prospeccion'),
  ).length;
  expect(conEtiqueta).toBe(body.metrics?.withEmail ?? conEtiqueta);
  expect(conEtiqueta).toBeGreaterThan(0);
  expect(conEtiqueta).toBeLessThanOrEqual(20);
});
```

> Si el fixture `prospects.csv` resulta tener las 20 filas con correo, la
> segunda aserción no distingue nada. Verificarlo con
> `grep -c ',' tests/fixtures/prospects.csv` y, si es el caso, agregar al
> fixture una fila sin correo o usar un fixture propio de dos filas.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- app/api/contacts/import/route.test.ts -t "startSequence"`
Expected: FAIL — el segundo argumento llega `undefined`.

- [ ] **Step 3: Leer la bandera en la ruta de importación**

En `app/api/contacts/import/route.ts`, junto a `dryRun`:

```ts
  const startSequence = form.get('startSequence') === '1';
```

Y cambiar la llamada del final:

```ts
  const report = await importProspects(mapped, { startSequence });
```

- [ ] **Step 4: Aceptar `mode` en la ruta de reintento**

En `app/api/contacts/import/retry/route.ts`, ampliar el tipo del cuerpo y la llamada:

```ts
  let body: { batchTag?: string; rows?: RawProspect[]; mode?: 'normal' | 'forceUpdate' } | null;
```

```ts
  const report = await importProspects(mapped, {
    onDuplicate: body?.mode === 'forceUpdate' ? 'update' : 'report',
  });
```

> El reintento **nunca** pasa `startSequence`. Una fila corregida a mano vuelve a entrar como nueva y recibe la etiqueta de secuencia solo si el lote original la pidió — que es una decisión que ya se tomó y no se repite acá. Si más adelante hace falta, se agrega al cuerpo.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS, toda la suite.

- [ ] **Step 6: Commit**

```bash
git add app/api/contacts/import/route.ts app/api/contacts/import/retry/route.ts app/api/contacts/import/route.test.ts
git commit -m "feat(importador): las rutas pasan startSequence y modo de duplicados"
```

---

## Task 4: Interfaz — casilla para iniciar la secuencia

**Files:**
- Modify: `components/ContactImport.tsx:30-38` (estado), `:57-63` (`postFile`), bloque de previsualización

**Interfaces:**
- Consumes: el form `startSequence=1` (Task 3)
- Produces: estado `startSequence` en el componente

- [ ] **Step 1: Agregar el estado**

En `components/ContactImport.tsx`, junto a los demás `useState`:

```tsx
  const [startSequence, setStartSequence] = useState(false);
```

- [ ] **Step 2: Enviar la bandera**

Cambiar `postFile` para que la mande cuando no sea previsualización:

```tsx
  async function postFile(f: File, dryRun: boolean) {
    const form = new FormData();
    form.append('file', f);
    if (!dryRun && startSequence) form.append('startSequence', '1');
    return parseJson(
      await fetch(`/api/contacts/import${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', body: form }),
    );
  }
```

> Verificar las líneas exactas de `postFile` antes de reemplazar: hoy hace `form.append('file', f)` y arma la URL igual.

- [ ] **Step 3: Agregar la casilla a la previsualización**

En el bloque `phase === 'preview'`, justo antes de los botones de confirmar:

```tsx
<label className="glass rounded-2xl p-4 flex items-start gap-3 cursor-pointer">
  <input
    type="checkbox"
    checked={startSequence}
    onChange={(e) => setStartSequence(e.target.checked)}
    className="mt-0.5 accent-[--color-green-glow]"
  />
  <span className="text-[13px] leading-[1.5]">
    <span className="font-medium">Iniciar la secuencia de correos con este lote</span>
    <span className="block text-[12px] text-[--color-cream-mute] mt-1">
      {preview.metrics.withEmail} de {preview.metrics.total} contactos tienen correo y
      recibirían el primer mensaje. Los repetidos y los que no tienen correo quedan fuera.
    </span>
  </span>
</label>
```

- [ ] **Step 4: Verificar en el navegador**

Run: `npm run dev`, ir a `/importar`, subir un CSV de prueba.
Expected: la casilla aparece **desmarcada**, el conteo coincide con `withEmail`, y marcarla no dispara nada hasta darle confirmar.

- [ ] **Step 5: Commit**

```bash
git add components/ContactImport.tsx
git commit -m "feat(importador): casilla para iniciar la secuencia, desmarcada por defecto"
```

---

## Task 5: Interfaz — bandeja de duplicados

**Files:**
- Create: `components/import/DuplicateTray.tsx`
- Modify: `components/ContactImport.tsx` (tipos, estado, `confirm`, render)

**Interfaces:**
- Consumes: `report.duplicates: DuplicateRow[]` (Task 1), `mode: 'forceUpdate'` en retry (Task 3)
- Produces: `<DuplicateTray rows onDiscard onImportAnyway busy />`

- [ ] **Step 1: Crear el componente**

`components/import/DuplicateTray.tsx`:

```tsx
'use client';
import { AlertTriangle, Trash2, ArrowRight } from 'lucide-react';
import type { RawProspect } from '@/lib/prospect-types';

export type DuplicateRow = {
  rowNumber: number; name: string; company: string;
  matchedBy: 'email' | 'phone' | 'fingerprint';
  existingId: string;
  incoming: Record<string, string>;
  existing: Record<string, string>;
  differingFields: string[];
  raw: RawProspect;
};

const ETIQUETA: Record<string, string> = {
  firstName: 'Nombre', lastName: 'Apellido', companyName: 'Empresa',
  email: 'Correo', phone: 'Teléfono',
};
const MOTIVO: Record<DuplicateRow['matchedBy'], string> = {
  email: 'Ya existe un contacto con ese correo.',
  phone: 'Ya existe un contacto con ese teléfono.',
  fingerprint: 'Ya existe un contacto con ese nombre y empresa.',
};

export function DuplicateTray({
  rows, busy, onEdit, onRetryFixed, onDiscard, onImportAnyway,
}: {
  rows: DuplicateRow[];
  busy: boolean;
  onEdit: (rowNumber: number, patch: { email?: string; phone?: string }) => void;
  onRetryFixed: (row: DuplicateRow) => void;
  onDiscard: (rowNumber: number) => void;
  onImportAnyway: (row: DuplicateRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="font-medium text-[13px]">
        {rows.length} {rows.length === 1 ? 'contacto ya existe' : 'contactos ya existen'} en Bralto
        — no se importaron ni recibieron correos
      </div>

      {rows.map((d) => (
        <div key={d.rowNumber} className="glass rounded-2xl p-4 flex flex-col gap-2.5">
          <div className="font-medium">
            {d.name || 'Sin nombre'}{' '}
            <span className="text-[--color-cream-mute] font-normal">
              · {d.company || 'sin empresa'} · fila {d.rowNumber}
            </span>
          </div>
          <div className="flex items-start gap-2 text-[12.5px] text-amber-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {MOTIVO[d.matchedBy]}
          </div>

          {d.differingFields.length > 0 ? (
            <div className="flex flex-col gap-1 text-[12.5px]">
              <div className="text-[--color-cream-mute]">Diferencias con lo que hay en Bralto:</div>
              {d.differingFields.map((f) => (
                <div key={f} className="flex flex-wrap items-center gap-2">
                  <span className="text-[--color-cream-mute] w-[70px]">{ETIQUETA[f] || f}</span>
                  <span className="line-through opacity-60">{d.existing[f] || '(vacío)'}</span>
                  <ArrowRight size={12} className="opacity-50" />
                  <span>{d.incoming[f] || '(vacío)'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-[--color-cream-mute]">
              Los datos del archivo coinciden con los de Bralto.
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <label className="flex-1 text-[12px] text-[--color-cream-mute]">
              Correo
              <input
                value={d.raw.email}
                onChange={(e) => onEdit(d.rowNumber, { email: e.target.value })}
                className="mt-1 w-full glass-pill rounded-lg px-3 py-1.5 text-[13px] text-[--color-cream] bg-transparent"
                placeholder="correo@ejemplo.com"
              />
            </label>
            <label className="flex-1 text-[12px] text-[--color-cream-mute]">
              Teléfono
              <input
                value={d.raw.phone}
                onChange={(e) => onEdit(d.rowNumber, { phone: e.target.value })}
                className="mt-1 w-full glass-pill rounded-lg px-3 py-1.5 text-[13px] text-[--color-cream] bg-transparent"
                placeholder="+506…"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onRetryFixed(d)}
              disabled={busy}
              className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] text-[--color-green-glow] disabled:opacity-50"
            >
              Corregir y reintentar
            </button>
            <button
              onClick={() => onImportAnyway(d)}
              disabled={busy}
              className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] disabled:opacity-50"
            >
              Importar de todos modos (sin correos)
            </button>
            <button
              onClick={() => onDiscard(d.rowNumber)}
              disabled={busy}
              className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] disabled:opacity-50"
            >
              <Trash2 size={12} /> Descartar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Conectarlo en `ContactImport.tsx`**

Importar arriba:

```tsx
import { DuplicateTray, type DuplicateRow } from '@/components/import/DuplicateTray';
```

Ampliar el tipo `Report` local (línea ~22):

```tsx
type Report = {
  created: number; updated: number;
  failed: FailedRow[]; duplicates: DuplicateRow[];
  missingCustomFields: string[]; pipelineResolved: boolean;
};
```

Agregar estado junto a `failedRows`:

```tsx
  const [duplicateRows, setDuplicateRows] = useState<DuplicateRow[]>([]);
```

En `confirm()`, después de `setFailedRows(body.report.failed);`:

```tsx
      setDuplicateRows(body.report.duplicates ?? []);
```

En `reset()`, agregar `setDuplicateRows([]);` junto a los demás.

- [ ] **Step 3: Agregar las dos acciones**

```tsx
  function discardDuplicate(rowNumber: number) {
    setDuplicateRows((rows) => rows.filter((r) => r.rowNumber !== rowNumber));
  }

  function editDuplicate(rowNumber: number, patch: { email?: string; phone?: string }) {
    setDuplicateRows((rows) =>
      rows.map((r) => (r.rowNumber === rowNumber ? { ...r, raw: { ...r.raw, ...patch } } : r)),
    );
  }

  /** Reenvía la fila corregida en modo normal: si ya no choca, se crea. */
  async function retryFixedDuplicate(row: DuplicateRow) {
    await sendDuplicate(row, 'normal');
  }

  async function importAnyway(row: DuplicateRow) {
    await sendDuplicate(row, 'forceUpdate');
  }

  /** Único camino al servidor para las dos acciones de la bandeja de duplicados. */
  async function sendDuplicate(row: DuplicateRow, mode: 'normal' | 'forceUpdate') {
    setRetrying(true);
    setError('');
    try {
      const res = await fetch('/api/contacts/import/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchTag, rows: [row.raw], mode }),
      });
      const body = (await parseJson(res)) as { report: Report };
      setTotals((t) => ({ created: t.created + body.report.created, updated: t.updated + body.report.updated }));
      if (body.report.failed.length) {
        setFailedRows((f) => [...f, ...body.report.failed]);
      }
      // Si sigue chocando en modo normal, vuelve como duplicado: se queda en la
      // bandeja con los datos frescos en vez de desaparecer sin explicación.
      const sigueDuplicada = (body.report.duplicates ?? []).find(
        (d) => d.rowNumber === row.rowNumber,
      );
      setDuplicateRows((rows) =>
        sigueDuplicada
          ? rows.map((r) => (r.rowNumber === row.rowNumber ? sigueDuplicada : r))
          : rows.filter((r) => r.rowNumber !== row.rowNumber),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }
```

- [ ] **Step 4: Montar la bandeja**

En el bloque `phase === 'done'`, **antes** del bloque `{failedRows.length > 0 && (` — los duplicados van primero porque requieren decisión:

```tsx
          <DuplicateTray
            rows={duplicateRows}
            busy={retrying}
            onEdit={editDuplicate}
            onRetryFixed={retryFixedDuplicate}
            onDiscard={discardDuplicate}
            onImportAnyway={importAnyway}
          />
```

Y en el resumen de la cabecera (línea ~242), sumar el conteo:

```tsx
                {duplicateRows.length > 0 && ` · ${duplicateRows.length} ya existían`}
```

- [ ] **Step 5: Verificar en el navegador**

Run: `npm run dev`
Preparar un CSV de dos filas: una con un correo que **no** exista en GHL, otra con un correo que **sí** exista (usar uno del lodge, p. ej. tomado del panel de contactos).
Expected:
- La fila nueva se crea.
- La repetida aparece en la bandeja con el motivo y las diferencias, y **no** se creó ni actualizó en GHL.
- "Descartar" la quita de la lista sin llamar al servidor.
- "Corregir y reintentar" con un correo libre la crea y la saca de la bandeja;
  con un correo que también existe, la fila **vuelve** a la bandeja con el motivo
  actualizado en vez de desaparecer.
- "Importar de todos modos" la actualiza, le pone `duplicado-revisar` y la quita de la lista.

- [ ] **Step 6: Correr toda la suite y el lint**

Run: `npm test && npm run lint`
Expected: PASS ambos.

- [ ] **Step 7: Commit**

```bash
git add components/import/DuplicateTray.tsx components/ContactImport.tsx
git commit -m "feat(importador): bandeja de duplicados con descartar e importar de todos modos"
```

---

## Verificación final antes de producción

Estas no son tareas de código, pero **el sistema no funciona sin ellas**. Confirmarlas en GHL antes de la primera importación real:

- [ ] Los Waits del WF1 están en **7 / 7 / 7 / 3 días** (se bajaron a 2 minutos para las pruebas del 2026-08-20).
- [ ] El `Correo 1 · Presentación` no tiene el `test` al inicio del cuerpo ni el nombre propio que el cliente pidió quitar.
- [ ] El `Correo 2 · Seguimiento` no tiene la firma duplicada.
- [ ] El `Correo 4 · Último intento` se revisó — nunca llegó a enviarse en las pruebas.
- [ ] Los cuatro correos llevan identificación del remitente y enlace de baja funcional (CASL, prospectos canadienses).
- [ ] `allowDuplicateContact` sigue en `false`.
- [ ] Prueba de humo: importar un archivo de dos filas con la casilla marcada y confirmar en GHL que solo la fila nueva con correo recibe el primer mensaje.
