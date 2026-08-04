# Bandeja de reintento + pestaña propia — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir las filas que rebotan al importar en tarjetas editables (con pista de error en español y acciones "Mantener correo/teléfono") que se pueden reintentar, y mover el importador de un modal a su propia página `/importar`.

**Architecture:** Se extrae el "motor" de importación de la ruta a `lib/prospect-importer.ts` para que la ruta de archivo y una ruta nueva de reintento lo compartan. El reporte enriquece cada fila fallida con datos completos + pista. La UI del importador pasa a una página dedicada.

**Tech Stack:** Next.js 16 (route handlers + páginas, `runtime='nodejs'`), React 19, TypeScript, vitest. GHL vía `lib/ghl.ts`.

**Spec:** `docs/superpowers/specs/2026-08-03-import-retry-tray-design.md`

## Global Constraints

- Node v24, Next.js `16.2.6`, React `19.2.4`. Rutas API: `export const runtime = 'nodejs'` y `export const dynamic = 'force-dynamic'`.
- Auth de rutas API: `const auth = await requireUser(); if (auth.error) return auth.error;`. El `middleware.ts` ya exige sesión para todo salvo `/api/webhooks|chatbot|cron`, así que `/importar` y `/api/contacts/import/retry` quedan protegidos automáticamente (el fetch del navegador lleva la cookie de sesión).
- GHL solo vía helpers de `lib/ghl.ts`. Reintento y archivo comparten `importProspects`.
- Textos de UI en español; el nombre visible del CRM es **"Bralto"** (no "GoHighLevel").
- Path alias `@/*` → `./*`. Módulos server-side hacen `import 'server-only'` (aliasado a stub en vitest).
- Antes de tocar route handlers/páginas nuevas, revisar `node_modules/next/dist/docs/01-app` (regla de AGENTS.md).

---

## Estructura de archivos

| Archivo | Responsabilidad | Task |
|---|---|---|
| `lib/prospect-importer.ts` | Motor de importación (`importProspects`), dedup (`findExisting`), pistas de error (`explainGhlError`), tipos `ImportReport`/`FailedRow` | 1 |
| `lib/prospect-importer.test.ts` | Tests del motor + pistas | 1 |
| `app/api/contacts/import/route.ts` (modificar) | Usa `importProspects`; devuelve `batchTag` | 2 |
| `app/api/contacts/import/retry/route.ts` | Ruta de reintento (JSON) | 3 |
| `app/api/contacts/import/retry/route.test.ts` | Tests del reintento | 3 |
| `components/ContactImport.tsx` (modificar) | Bandeja de reintento editable + "Mantener correo/teléfono" | 4 |
| `app/importar/page.tsx` | Página propia del importador | 5 |
| `components/AppHeader.tsx` (modificar) | Pill "Importar contactos" → enlace a `/importar` | 5 |
| `components/Dashboard.tsx` (modificar) | Quitar el modal de importación | 5 |

---

## Task 1: Motor de importación + pistas de error (`lib/prospect-importer.ts`)

**Files:**
- Create: `lib/prospect-importer.ts`
- Create: `lib/prospect-importer.test.ts`

**Interfaces:**
- Consumes: `@/lib/ghl` (searchContacts, createContact, updateContact, createNote, createOpportunity, getPipelines, getCustomFields, addContactTags, GhlContact), `@/lib/prospect-parser` (DEFAULT_PIPELINE, DEFAULT_STAGE), `@/lib/prospect-mapper` (contactFingerprint, MappedProspect), `@/lib/prospect-types` (RawProspect).
- Produces:
  - `type FailedRow = { rowNumber: number; name: string; reason: string; hint: string; matchingField?: 'phone'|'email'; raw: RawProspect }`
  - `type ImportReport = { created: number; updated: number; failed: FailedRow[]; missingCustomFields: string[]; pipelineResolved: boolean }`
  - `explainGhlError(reason: string): { hint: string; matchingField?: 'phone'|'email' }`
  - `findExisting(m: MappedProspect): Promise<GhlContact | null>`
  - `importProspects(mapped: MappedProspect[]): Promise<ImportReport>`

- [ ] **Step 1: Escribir el test (debe fallar)**

`lib/prospect-importer.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawProspect } from './prospect-types';

vi.mock('@/lib/ghl', () => ({
  searchContacts: vi.fn(async () => []),
  createContact: vi.fn(async () => ({ id: 'c1' })),
  updateContact: vi.fn(async () => ({ id: 'c1' })),
  createNote: vi.fn(async () => {}),
  createOpportunity: vi.fn(async () => ({ id: 'o1' })),
  getPipelines: vi.fn(async () => []),
  getCustomFields: vi.fn(async () => []),
  addContactTags: vi.fn(async () => {}),
}));

import * as ghl from '@/lib/ghl';
import { mapProspect } from './prospect-mapper';
import { explainGhlError, importProspects } from './prospect-importer';

function raw(over: Partial<RawProspect>): RawProspect {
  return {
    firstName: 'Ana', lastName: 'Pérez', company: 'Viajes X', email: '', phone: '', website: '',
    city: '', state: '', country: '', source: '', tagsRaw: '', pipeline: '', stage: '',
    leadScore: '', priority: 'A', leadType: 'Advisor', pitchAngle: '', contactMethod: '',
    bestContactUrl: '', instagram: '', facebook: '', linkedin: '', marketReach: '',
    activityLevel: '', contentFit: '', notes: '', firstAction: '', natureFit: '',
    evidence: '', confidence: '', leadId: '', rowNumber: 1, ...over,
  };
}
const mapped = (over: Partial<RawProspect>) => [mapProspect(raw(over), 'Import-x')];

beforeEach(() => {
  vi.mocked(ghl.searchContacts).mockResolvedValue([]);
  vi.mocked(ghl.createContact).mockReset().mockResolvedValue({ id: 'c1' } as never);
  vi.mocked(ghl.updateContact).mockReset().mockResolvedValue({ id: 'c1' } as never);
  vi.mocked(ghl.addContactTags).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(ghl.createNote).mockReset().mockResolvedValue(undefined as never);
});

describe('explainGhlError', () => {
  it('duplicado por teléfono → pista de teléfono', () => {
    const r = explainGhlError('GHL 400 en /contacts/: {"statusCode":400,"message":"This location does not allow duplicated contacts.","meta":{"matchingField":"phone"}}');
    expect(r.matchingField).toBe('phone');
    expect(r.hint).toContain('teléfono');
  });
  it('duplicado por correo → pista de correo', () => {
    const r = explainGhlError('x {"message":"This location does not allow duplicated contacts.","meta":{"matchingField":"email"}}');
    expect(r.matchingField).toBe('email');
    expect(r.hint).toContain('correo');
  });
  it('teléfono muy largo → pista de teléfono inválido', () => {
    const r = explainGhlError('GHL 400: {"message":"The string supplied is too long to be a phone number"}');
    expect(r.hint).toContain('teléfono no es válido');
  });
  it('otro error → devuelve el mensaje crudo', () => {
    expect(explainGhlError('algo raro').hint).toBe('algo raro');
  });
});

describe('importProspects', () => {
  it('crea cuando no existe', async () => {
    const rep = await importProspects(mapped({ email: 'ana@x.com' }));
    expect(rep.created).toBe(1);
    expect(rep.updated).toBe(0);
    expect(ghl.createContact).toHaveBeenCalledTimes(1);
  });

  it('actualiza cuando ya existe (por correo)', async () => {
    vi.mocked(ghl.searchContacts).mockResolvedValue([
      { id: 'exist', email: 'ana@x.com' } as never,
    ]);
    const rep = await importProspects(mapped({ email: 'ana@x.com' }));
    expect(rep.updated).toBe(1);
    expect(rep.created).toBe(0);
    expect(ghl.updateContact).toHaveBeenCalledWith('exist', expect.anything());
  });

  it('un fallo por fila no aborta y enriquece la fila con pista + raw', async () => {
    vi.mocked(ghl.createContact).mockRejectedValueOnce(
      new Error('GHL 400 en /contacts/: {"message":"This location does not allow duplicated contacts.","meta":{"matchingField":"phone"}}'),
    );
    const rep = await importProspects(mapped({ email: 'ana@x.com', rowNumber: 7 }));
    expect(rep.created).toBe(0);
    expect(rep.failed).toHaveLength(1);
    expect(rep.failed[0].rowNumber).toBe(7);
    expect(rep.failed[0].matchingField).toBe('phone');
    expect(rep.failed[0].hint).toContain('teléfono');
    expect(rep.failed[0].raw.email).toBe('ana@x.com');
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npm test -- prospect-importer`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el motor**

`lib/prospect-importer.ts`:
```ts
import 'server-only';
import {
  searchContacts, createContact, updateContact, createNote, createOpportunity,
  getPipelines, getCustomFields, addContactTags, type GhlContact,
} from '@/lib/ghl';
import { DEFAULT_PIPELINE, DEFAULT_STAGE } from '@/lib/prospect-parser';
import { contactFingerprint, type MappedProspect } from '@/lib/prospect-mapper';
import type { RawProspect } from '@/lib/prospect-types';

export type FailedRow = {
  rowNumber: number;
  name: string;
  reason: string;
  hint: string;
  matchingField?: 'phone' | 'email';
  raw: RawProspect;
};

export type ImportReport = {
  created: number;
  updated: number;
  failed: FailedRow[];
  missingCustomFields: string[];
  pipelineResolved: boolean;
};

/** Traduce el error crudo de GHL a una pista accionable en español. */
export function explainGhlError(reason: string): { hint: string; matchingField?: 'phone' | 'email' } {
  let parsed: { message?: string; meta?: { matchingField?: string } } | null = null;
  const brace = reason.indexOf('{');
  if (brace >= 0) {
    try {
      parsed = JSON.parse(reason.slice(brace));
    } catch {
      parsed = null;
    }
  }
  const message = (parsed?.message || reason).toLowerCase();
  const matchingField = parsed?.meta?.matchingField;
  if (message.includes('duplicated')) {
    if (matchingField === 'email') {
      return { hint: 'Ya existe un contacto con ese correo.', matchingField: 'email' };
    }
    return {
      hint: 'Ya existe un contacto con ese teléfono (línea de agencia compartida). Quita el teléfono o pon uno propio.',
      matchingField: 'phone',
    };
  }
  if (message.includes('too long') && message.includes('phone')) {
    return { hint: 'El teléfono no es válido. Corrígelo o quítalo.' };
  }
  return { hint: reason };
}

/** Busca un contacto ya existente para evitar duplicados. */
export async function findExisting(m: MappedProspect): Promise<GhlContact | null> {
  const query =
    m.contact.email || m.contact.phone || `${m.contact.firstName} ${m.contact.lastName}`.trim();
  if (!query) return null;

  const results = await searchContacts({ query });
  if (!results.length) return null;

  if (m.contact.email) {
    const e = m.contact.email.toLowerCase();
    return results.find((c) => (c.email || '').toLowerCase() === e) || null;
  }
  if (m.contact.phone) {
    const norm = (s: string) => s.replace(/\D/g, '').slice(-10);
    const target = norm(m.contact.phone);
    const candidate = results.find(
      (c) => norm(c.phone || '') !== '' && norm(c.phone || '') === target,
    );
    if (!candidate) return null;
    const sameFingerprint =
      contactFingerprint(candidate.firstName || '', candidate.lastName || '', candidate.companyName || '') ===
      m.fingerprint;
    const candidateHasNoName = !(candidate.firstName || candidate.lastName);
    return sameFingerprint || candidateHasNoName ? candidate : null;
  }
  return (
    results.find(
      (c) => contactFingerprint(c.firstName || '', c.lastName || '', c.companyName || '') === m.fingerprint,
    ) || null
  );
}

/** Motor de importación: crea/actualiza cada prospecto en GHL y arma el reporte. */
export async function importProspects(mapped: MappedProspect[]): Promise<ImportReport> {
  const report: ImportReport = {
    created: 0,
    updated: 0,
    failed: [],
    missingCustomFields: [],
    pipelineResolved: false,
  };
  if (!mapped.length) return report;

  const cfByName = new Map<string, string>();
  try {
    for (const f of await getCustomFields()) cfByName.set(f.name.trim().toLowerCase(), f.id);
  } catch {
    /* sin custom fields */
  }

  let pipelineId = '';
  let stageId = '';
  try {
    const wantPipe = (mapped[0].raw.pipeline || DEFAULT_PIPELINE).trim().toLowerCase();
    const wantStage = (mapped[0].raw.stage || DEFAULT_STAGE).trim().toLowerCase();
    const pipe = (await getPipelines()).find((p) => p.name.trim().toLowerCase() === wantPipe);
    if (pipe) {
      pipelineId = pipe.id;
      const stage = pipe.stages.find((s) => s.name.trim().toLowerCase() === wantStage) || pipe.stages[0];
      stageId = stage?.id || '';
      report.pipelineResolved = Boolean(pipelineId && stageId);
    }
  } catch {
    /* sin pipeline */
  }

  const missing = new Set<string>();

  for (const m of mapped) {
    try {
      const resolvedCF = m.customFields
        .map((f) => {
          const id = cfByName.get(f.name.trim().toLowerCase());
          if (!id) {
            missing.add(f.name);
            return null;
          }
          return { id, field_value: f.value };
        })
        .filter((x): x is { id: string; field_value: string } => x !== null);

      const fields = { ...m.contact, customFields: resolvedCF };

      const existing = await findExisting(m);
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

      if (m.tags.length) await addContactTags(contactId, m.tags);
      if (outcome === 'created') {
        if (m.note) await createNote(contactId, m.note);
        if (report.pipelineResolved) {
          await createOpportunity({ pipelineId, stageId, name: m.opportunityName, contactId });
        }
      }

      if (outcome === 'created') report.created++;
      else report.updated++;
    } catch (e) {
      const reason = (e as Error).message;
      const { hint, matchingField } = explainGhlError(reason);
      report.failed.push({
        rowNumber: m.raw.rowNumber,
        name: m.contact.name,
        reason,
        hint,
        matchingField,
        raw: m.raw,
      });
    }
  }

  report.missingCustomFields = [...missing];
  return report;
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npm test -- prospect-importer`
Expected: PASS.

- [ ] **Step 5: Verificar tipos y commit**

Run: `npx tsc --noEmit`
Expected: sin errores.

```bash
git add lib/prospect-importer.ts lib/prospect-importer.test.ts
git commit -m "feat: extraer motor de importación + pistas de error a lib/prospect-importer"
```

---

## Task 2: Rutar el import de archivo por el motor (modificar `route.ts`)

**Files:**
- Modify: `app/api/contacts/import/route.ts`

**Interfaces:**
- Consumes: `importProspects` (Task 1), `mapProspect`/`deriveBatchTag` (existentes), `parseProspectFile`/`DEFAULT_SOURCE` (existentes), `validateProspects`, `summarizeBatch`.
- Produces: respuesta real ahora `{ ok: true, report: ImportReport, batchTag: string }`; dryRun ahora incluye `batchTag`.

- [ ] **Step 1: Reemplazar el cuerpo de la ruta**

Sustituir TODO el contenido de `app/api/contacts/import/route.ts` por:
```ts
import { requireUser } from '@/lib/api-auth';
import { parseProspectFile, DEFAULT_SOURCE } from '@/lib/prospect-parser';
import { validateProspects } from '@/lib/prospect-validator';
import { mapProspect, deriveBatchTag } from '@/lib/prospect-mapper';
import { summarizeBatch } from '@/lib/prospect-summary';
import { importProspects } from '@/lib/prospect-importer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Se esperaba multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Falta el archivo' }, { status: 400 });
  }

  const dryRun =
    new URL(req.url).searchParams.get('dryRun') === '1' || form.get('dryRun') === '1';

  let parsed;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    parsed = parseProspectFile(buf, file.name);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }

  const { prospects, format } = parsed;
  if (!prospects.length) {
    return Response.json({ error: 'El archivo no tiene filas' }, { status: 422 });
  }

  const { validations, metrics } = validateProspects(prospects);
  const batchSeed =
    prospects[0].source && prospects[0].source !== DEFAULT_SOURCE ? prospects[0].source : file.name;
  const batchTag = deriveBatchTag(batchSeed);
  const mapped = prospects.map((p) => mapProspect(p, batchTag));

  if (dryRun) {
    const sampleWarnings = validations.flatMap((v) => v.warnings).slice(0, 10);
    const summary = await summarizeBatch({ metrics, sampleWarnings });
    const preview = mapped.map((m, i) => ({
      rowNumber: m.raw.rowNumber,
      name: m.contact.name,
      company: m.contact.companyName,
      email: m.contact.email,
      phone: m.contact.phone,
      tags: m.tags,
      hasContactChannel: m.hasContactChannel,
      warnings: validations[i].warnings,
    }));
    return Response.json({ ok: true, format, metrics, summary, preview, batchTag });
  }

  const report = await importProspects(mapped);
  return Response.json({ ok: true, report, batchTag });
}
```

- [ ] **Step 2: Correr los tests de la ruta (deben seguir pasando)**

Run: `npm test -- contacts/import`
Expected: PASS. Los tests existentes verifican `report.created/updated/failed.length` y las llamadas a GHL — el comportamiento es idéntico (solo se movió el código). Si algún test fallara por el `import` viejo de `findExisting`, es que el test importaba algo de la ruta que ya no existe; en ese caso, corregir el import del test para usar `@/lib/prospect-importer`.

- [ ] **Step 3: tsc + commit**

Run: `npx tsc --noEmit`
Expected: sin errores.

```bash
git add app/api/contacts/import/route.ts
git commit -m "refactor: la ruta de import usa el motor extraído y devuelve batchTag"
```

---

## Task 3: Ruta de reintento (`/api/contacts/import/retry`)

**Files:**
- Create: `app/api/contacts/import/retry/route.ts`
- Create: `app/api/contacts/import/retry/route.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `mapProspect` (existente), `importProspects` (Task 1), `RawProspect`.
- Produces: `POST /api/contacts/import/retry` con body `{ batchTag: string; rows: RawProspect[] }` → `{ ok: true, report: ImportReport, batchTag: string }`.

- [ ] **Step 1: Escribir el test (debe fallar)**

`app/api/contacts/import/retry/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawProspect } from '@/lib/prospect-types';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(async () => ({ user: { email: 'x@y.com' }, error: null })),
}));

const ghl = {
  searchContacts: vi.fn(async () => []),
  createContact: vi.fn(async () => ({ id: 'c1' })),
  updateContact: vi.fn(async () => ({ id: 'c1' })),
  createNote: vi.fn(async () => {}),
  createOpportunity: vi.fn(async () => ({ id: 'o1' })),
  getPipelines: vi.fn(async () => []),
  getCustomFields: vi.fn(async () => []),
  addContactTags: vi.fn(async () => {}),
};
vi.mock('@/lib/ghl', () => ghl);

function raw(over: Partial<RawProspect>): RawProspect {
  return {
    firstName: 'Ana', lastName: 'Pérez', company: 'Viajes X', email: '', phone: '', website: '',
    city: '', state: '', country: '', source: '', tagsRaw: '', pipeline: '', stage: '',
    leadScore: '', priority: 'A', leadType: 'Advisor', pitchAngle: '', contactMethod: '',
    bestContactUrl: '', instagram: '', facebook: '', linkedin: '', marketReach: '',
    activityLevel: '', contentFit: '', notes: '', firstAction: '', natureFit: '',
    evidence: '', confidence: '', leadId: '', rowNumber: 1, ...over,
  };
}
function req(body: unknown): Request {
  return new Request('http://t/api/contacts/import/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => Object.values(ghl).forEach((f) => f.mockClear?.()));

describe('POST /api/contacts/import/retry', () => {
  it('rechaza body sin filas', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ batchTag: 'Import-x', rows: [] }));
    expect(res.status).toBe(400);
  });

  it('importa las filas enviadas y devuelve el reporte', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ batchTag: 'Import-x', rows: [raw({ email: 'ana@x.com' })] }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.report.created).toBe(1);
    expect(ghl.createContact).toHaveBeenCalledTimes(1);
    expect(body.batchTag).toBe('Import-x');
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npm test -- retry`
Expected: FAIL — la ruta no existe.

- [ ] **Step 3: Implementar la ruta**

`app/api/contacts/import/retry/route.ts`:
```ts
import { requireUser } from '@/lib/api-auth';
import { mapProspect } from '@/lib/prospect-mapper';
import { importProspects } from '@/lib/prospect-importer';
import type { RawProspect } from '@/lib/prospect-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: { batchTag?: string; rows?: RawProspect[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: 'No hay filas para reintentar' }, { status: 400 });
  }
  if (rows.length > 500) {
    return Response.json({ error: 'Demasiadas filas (máx 500)' }, { status: 400 });
  }

  const batchTag = typeof body.batchTag === 'string' ? body.batchTag : '';
  const mapped = rows.map((r) => mapProspect(r, batchTag));
  const report = await importProspects(mapped);
  return Response.json({ ok: true, report, batchTag });
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npm test -- retry`
Expected: PASS (2 casos).

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`
Expected: sin errores.

```bash
git add app/api/contacts/import/retry/route.ts app/api/contacts/import/retry/route.test.ts
git commit -m "feat: ruta /api/contacts/import/retry (reimporta filas corregidas)"
```

---

## Task 4: Bandeja de reintento editable (`components/ContactImport.tsx`)

**Files:**
- Modify: `components/ContactImport.tsx` (reemplazo completo)

**Interfaces:**
- Consumes: `POST /api/contacts/import` (devuelve `report` + `batchTag`), `POST /api/contacts/import/retry`, `type RawProspect` de `@/lib/prospect-types`.
- Produces: componente `ContactImport` con la fase de resultados interactiva.

- [ ] **Step 1: Reemplazar el componente**

Sustituir TODO `components/ContactImport.tsx` por:
```tsx
'use client';
import { useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';
import type { RawProspect } from '@/lib/prospect-types';

type PreviewRow = {
  rowNumber: number; name: string; company: string; email: string; phone: string;
  tags: string[]; hasContactChannel: boolean; warnings: string[];
};
type Metrics = {
  total: number; withChannel: number; withoutChannel: number;
  withEmail: number; withPhone: number; invalidEmails: number;
};
type Preview = {
  ok: true; format: string; metrics: Metrics;
  summary: { text: string; alerts: string[] }; preview: PreviewRow[]; batchTag: string;
};
type FailedRow = {
  rowNumber: number; name: string; reason: string; hint: string;
  matchingField?: 'phone' | 'email'; raw: RawProspect;
};
type Report = {
  created: number; updated: number;
  failed: FailedRow[]; missingCustomFields: string[]; pipelineResolved: boolean;
};

type Phase = 'idle' | 'previewing' | 'preview' | 'importing' | 'done' | 'error';

export function ContactImport() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [batchTag, setBatchTag] = useState('');
  const [totals, setTotals] = useState({ created: 0, updated: 0 });
  const [failedRows, setFailedRows] = useState<FailedRow[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');

  async function parseJson(res: Response) {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      throw new Error(
        (body.error as string) ||
          (res.status === 401 ? 'Tu sesión expiró. Iniciá sesión de nuevo.' : 'Error ' + res.status),
      );
    }
    return body;
  }

  async function postFile(f: File, dryRun: boolean) {
    const form = new FormData();
    form.set('file', f);
    return parseJson(
      await fetch(`/api/contacts/import${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', body: form }),
    );
  }

  async function onFile(f: File) {
    setFile(f);
    setError('');
    setPhase('previewing');
    try {
      setPreview((await postFile(f, true)) as unknown as Preview);
      setPhase('preview');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }

  async function confirm() {
    if (!file) return;
    setPhase('importing');
    setError('');
    try {
      const body = (await postFile(file, false)) as { report: Report; batchTag: string };
      setReport(body.report);
      setBatchTag(body.batchTag);
      setTotals({ created: body.report.created, updated: body.report.updated });
      setFailedRows(body.report.failed);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }

  function editRow(idx: number, patch: Partial<RawProspect>) {
    setFailedRows((rows) => rows.map((r, i) => (i === idx ? { ...r, raw: { ...r.raw, ...patch } } : r)));
  }

  async function retry() {
    if (!failedRows.length) return;
    setRetrying(true);
    setError('');
    try {
      const res = await fetch('/api/contacts/import/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchTag, rows: failedRows.map((f) => f.raw) }),
      });
      const body = (await parseJson(res)) as { report: Report };
      setTotals((t) => ({
        created: t.created + body.report.created,
        updated: t.updated + body.report.updated,
      }));
      setFailedRows(body.report.failed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  function reset() {
    setPhase('idle');
    setFile(null);
    setPreview(null);
    setReport(null);
    setBatchTag('');
    setTotals({ created: 0, updated: 0 });
    setFailedRows([]);
    setError('');
  }

  return (
    <div className="text-[--color-cream] text-[14px]">
      {(phase === 'idle' || phase === 'previewing') && (
        <label
          className="glass flex flex-col items-center justify-center gap-3 py-10 px-6 rounded-2xl cursor-pointer text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
        >
          {phase === 'previewing' ? (
            <Loader2 className="animate-spin" size={26} />
          ) : (
            <Upload size={26} className="opacity-80" />
          )}
          <div className="font-medium">
            {phase === 'previewing' ? 'Analizando el archivo…' : 'Arrastrá o elegí un archivo (CSV o Excel)'}
          </div>
          <div className="text-[12px] text-[--color-cream-mute]">
            Se leerá el archivo y verás un resumen antes de importar. Nada se crea todavía.
          </div>
          <input
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            disabled={phase === 'previewing'}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>
      )}

      {phase === 'preview' && preview && (
        <div className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-4">
            <p className="leading-relaxed">{preview.summary.text}</p>
            {preview.summary.alerts.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1">
                {preview.summary.alerts.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px] text-amber-300">
                    <AlertTriangle size={14} /> {a}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="glass rounded-2xl overflow-hidden">
            <div className="max-h-[42vh] overflow-auto">
              <table className="w-full text-[12.5px]">
                <thead className="text-[--color-cream-mute] text-left sticky top-0 bg-[rgba(20,32,26,0.9)]">
                  <tr>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Empresa</th>
                    <th className="px-3 py-2">Contacto</th>
                    <th className="px-3 py-2">Etiquetas</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-white/5">
                      <td className="px-3 py-2 whitespace-nowrap">{r.name || '—'}</td>
                      <td className="px-3 py-2">{r.company || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.hasContactChannel ? r.email || r.phone : <span className="text-amber-300">Pendiente</span>}
                      </td>
                      <td className="px-3 py-2 text-[--color-cream-mute]">{r.tags.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button onClick={reset} className="glass-pill px-4 py-2 rounded-full text-[13px]">
              Cancelar
            </button>
            <button
              onClick={confirm}
              className="px-5 py-2 rounded-full text-[13px] font-medium text-[--color-green-glow] glass-pill"
            >
              Confirmar e importar {preview.metrics.total}
            </button>
          </div>
        </div>
      )}

      {phase === 'importing' && (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="animate-spin" size={26} />
          <div>Agregando a Bralto…</div>
        </div>
      )}

      {phase === 'done' && report && (
        <div className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-5 flex items-start gap-3">
            <CheckCircle2 className="text-[--color-green-glow] mt-0.5" size={22} />
            <div>
              <div className="font-medium">
                {failedRows.length === 0 ? '¡Todo cargado!' : 'Importación completa'}
              </div>
              <div className="text-[13px] text-[--color-cream-mute] mt-1">
                {totals.created} creados · {totals.updated} ya existían y se actualizaron
                {failedRows.length > 0 && ` · ${failedRows.length} con error`}
              </div>
              {!report.pipelineResolved && (
                <div className="text-[12px] text-amber-300 mt-2">
                  No se encontró el pipeline en Bralto: no se crearon oportunidades.
                </div>
              )}
              {report.missingCustomFields.length > 0 && (
                <div className="text-[12px] text-amber-300 mt-1">
                  Campos no encontrados en Bralto (no se llenaron): {report.missingCustomFields.join(', ')}
                </div>
              )}
            </div>
          </div>

          {failedRows.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="font-medium text-[13px]">Filas con error — corrígelas y reintenta</div>
                <button
                  onClick={retry}
                  disabled={retrying}
                  className="px-4 py-2 rounded-full text-[13px] font-medium text-[--color-green-glow] glass-pill disabled:opacity-50"
                >
                  {retrying ? 'Reintentando…' : `Reintentar (${failedRows.length})`}
                </button>
              </div>

              {failedRows.map((f, idx) => (
                <div key={f.rowNumber} className="glass rounded-2xl p-4 flex flex-col gap-2.5">
                  <div className="font-medium">
                    {f.name || 'Sin nombre'}{' '}
                    <span className="text-[--color-cream-mute] font-normal">· fila {f.rowNumber}</span>
                  </div>
                  <div className="flex items-start gap-2 text-[12.5px] text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {f.hint}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <label className="flex-1 text-[12px] text-[--color-cream-mute]">
                      Correo
                      <input
                        value={f.raw.email}
                        onChange={(e) => editRow(idx, { email: e.target.value })}
                        className="mt-1 w-full glass-pill rounded-lg px-3 py-1.5 text-[13px] text-[--color-cream] bg-transparent"
                        placeholder="correo@ejemplo.com"
                      />
                    </label>
                    <label className="flex-1 text-[12px] text-[--color-cream-mute]">
                      Teléfono
                      <input
                        value={f.raw.phone}
                        onChange={(e) => editRow(idx, { phone: e.target.value })}
                        className="mt-1 w-full glass-pill rounded-lg px-3 py-1.5 text-[13px] text-[--color-cream] bg-transparent"
                        placeholder="+506…"
                      />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => editRow(idx, { phone: '' })}
                      className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px]"
                    >
                      <X size={12} /> Mantener correo (quita el tel)
                    </button>
                    <button
                      onClick={() => editRow(idx, { email: '' })}
                      className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px]"
                    >
                      <X size={12} /> Mantener teléfono (quita el correo)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div className="text-[12.5px] text-amber-300">{error}</div>}

          <div className="flex justify-end">
            <button onClick={reset} className="glass-pill px-4 py-2 rounded-full text-[13px]">
              Importar otro archivo
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col gap-3">
          <div className="glass rounded-2xl p-5 flex items-start gap-3">
            <AlertTriangle className="text-amber-300 mt-0.5" size={22} />
            <div>
              <div className="font-medium">No se pudo procesar</div>
              <div className="text-[13px] text-[--color-cream-mute] mt-1">{error}</div>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={reset} className="glass-pill px-4 py-2 rounded-full text-[13px]">
              Volver a intentar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos y build**

Run: `npx tsc --noEmit && npm run build`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add components/ContactImport.tsx
git commit -m "feat: bandeja de reintento editable (mantener correo/teléfono + reintentar)"
```

---

## Task 5: Página propia `/importar` + quitar el modal

**Files:**
- Create: `app/importar/page.tsx`
- Modify: `components/AppHeader.tsx`
- Modify: `components/Dashboard.tsx`

**Interfaces:**
- Consumes: `ContactImport` (Task 4).
- Produces: ruta `/importar`; el header enlaza a ella; el Dashboard ya no monta el modal de importación.

- [ ] **Step 1: Leer la doc de páginas de Next**

Run: `ls node_modules/next/dist/docs/01-app` y confirmar el patrón de página (Server Component por defecto, `export default function`). La protección de sesión la da `middleware.ts` (ya cubre `/importar`).

- [ ] **Step 2: Crear la página**

`app/importar/page.tsx`:
```tsx
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ContactImport } from '@/components/ContactImport';

export const dynamic = 'force-dynamic';

export default function ImportarPage() {
  return (
    <div className="relative z-[2] max-w-[900px] mx-auto px-5 sm:px-9 pt-7 pb-20">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-[13px] text-[--color-cream-dim] hover:text-[--color-cream] transition"
      >
        <ArrowLeft size={15} /> Volver al panel
      </Link>
      <h1 className="mt-6 mb-2 text-[32px] font-light tracking-[-0.02em] text-[--color-cream]">
        Importar contactos
      </h1>
      <p className="mb-8 text-[14px] text-[--color-cream-mute] max-w-[560px] leading-[1.6]">
        Subí el archivo de prospectos (CSV o Excel). Verás un resumen y confirmás antes de crear en
        Bralto. Los que reboten podés corregirlos y reintentar aquí mismo.
      </p>
      <ContactImport />
    </div>
  );
}
```

- [ ] **Step 3: El pill del header enlaza a `/importar`**

En `components/AppHeader.tsx`:

1. Agregar el import de `Link` al inicio:
```tsx
import Link from 'next/link';
```
2. Quitar `onOpenImport` de las props (de la firma y del tipo). Es decir, eliminar la línea `onOpenImport,` del destructuring y la línea `onOpenImport: () => void;` del tipo.
3. Reemplazar el `<HeaderPill onClick={onOpenImport} …>` de "Importar contactos" por un enlace:
```tsx
        <Link
          href="/importar"
          className="glass-pill inline-flex items-center gap-2 px-4 py-[9px] rounded-full text-[--color-cream-dim] text-[12.5px] font-medium cursor-pointer transition-all duration-200 hover:text-[--color-cream] hover:-translate-y-[1px]"
        >
          <span className="opacity-85"><Upload size={14} /></span>
          <span className="hidden sm:inline">Importar contactos</span>
        </Link>
```
(El import de `Upload` de lucide-react ya existe en el archivo; mantenerlo.)

- [ ] **Step 4: Quitar el modal del Dashboard**

En `components/Dashboard.tsx`:

1. Eliminar el import `import { ContactImport } from './ContactImport';`.
2. Eliminar la línea de estado `const [importOpen, setImportOpen] = useState(false);`.
3. En el `<AppHeader … />`, eliminar la prop `onOpenImport={() => setImportOpen(true)}`.
4. Eliminar por completo el bloque del modal de importación:
```tsx
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar contactos"
        subtitle="Subí el archivo de prospectos (CSV o Excel). Verás un resumen y confirmás antes de crear en Bralto."
      >
        <ContactImport />
      </Modal>
```
(Dejar intactos los demás modales/drawers: Asistente y Tester.)

- [ ] **Step 5: Verificar tipos + build**

Run: `npx tsc --noEmit && npm run build`
Expected: compila; `/importar` aparece en la lista de rutas del build.

- [ ] **Step 6: Verificación manual**

Run: `npm run dev`
- En el panel, click en "Importar contactos" → navega a `/importar` (ya no abre modal).
- Subir `Natural Lodge.xlsx` → confirmar → en "Filas con error", una tarjeta con su pista; click "Mantener correo (quita el tel)" en una que tenga correo propio → "Reintentar (N)" → esa fila desaparece y suben los "creados".
- "← Volver al panel" regresa al Dashboard.
Expected: el flujo completo funciona en la página; los textos dicen "Bralto".

- [ ] **Step 7: Commit**

```bash
git add app/importar/page.tsx components/AppHeader.tsx components/Dashboard.tsx
git commit -m "feat: página propia /importar y baja del modal de importación"
```

---

## Notas de despliegue

- No hay migraciones ni variables de entorno nuevas.
- Deploy a producción con `vercel deploy --prod` (las llaves de GHL están en Production).

---

## Self-Review (autor)

**Cobertura del spec:**
- §2.1 mover a página `/importar` → Task 5. ✔
- §2.2 bandeja editable + pista + Mantener correo/teléfono → Task 4. ✔
- §2.3 Reintentar (N) → Task 4 (`retry()`). ✔
- §2.5 refactor motor `lib/prospect-importer.ts` → Task 1; rutas lo usan → Tasks 2 y 3. ✔
- §4 reporte con `hint`/`raw`/`matchingField` + `batchTag` en respuesta → Task 1 (FailedRow/ImportReport) + Task 2/3 (batchTag). ✔
- §5 `explainGhlError` (3 casos + fallback + matchingField) → Task 1. ✔
- §6 UI (estado failedRows/totals/batchTag, editRow, retry) → Task 4. ✔
- §7 errores (aislar por fila; retry valida body; auth por middleware+requireUser; "mantener correo" sin correo → contacto sin canal se crea) → Task 1 + Task 3. ✔
- §8 pruebas (explainGhlError, importProspects, retry) → Tasks 1 y 3; UI manual → Task 5. ✔

**Sin placeholders:** todo el código está completo.

**Consistencia de tipos:** `FailedRow`/`ImportReport` (Task 1) se consumen idénticos en las rutas (Tasks 2/3) y en el cliente (Task 4, mirror con los mismos campos). `importProspects(mapped: MappedProspect[])` y `explainGhlError(reason)` usan las mismas firmas en todos lados. `RawProspect` viene de `@/lib/prospect-types` en cliente y servidor.
