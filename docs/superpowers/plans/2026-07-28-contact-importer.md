# Importador de contactos B2B → GHL — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar al panel una pestaña "Importar contactos" que sube un CSV/XLSX de prospectos, lo previsualiza con un resumen de Claude, y con un clic crea los contactos en GoHighLevel con tags, nota, custom fields y oportunidad.

**Architecture:** Una ruta API (`POST /api/contacts/import`) con dos modos: `dryRun` (previsualiza, no toca GHL) y ejecución real. El parseo/mapeo/validación son módulos puros y testeables; `lib/ghl.ts` se extiende con las llamadas nuevas. La UI es un modal montado desde el header, siguiendo el patrón existente de `PromptAssistant`.

**Tech Stack:** Next.js 16 (route handlers, `runtime = 'nodejs'`), React 19, TypeScript, SheetJS (`xlsx`) para parseo CSV+XLSX, Anthropic SDK (ya presente), GHL REST v2 (`lib/ghl.ts`). Tests con **vitest**.

**Spec:** `docs/superpowers/specs/2026-07-28-contact-importer-design.md`

## Global Constraints

- **Node/Next:** Node v24, Next.js `16.2.6`, React `19.2.4`. Rutas API usan `export const runtime = 'nodejs'` y `export const dynamic = 'force-dynamic'`.
- **Antes de escribir el route handler (Task 7):** leer `node_modules/next/dist/docs/01-app` sobre Route Handlers (AGENTS.md lo exige — esta versión de Next puede diferir del conocimiento previo). Confirmar la firma `export async function POST(req: Request)` y el uso de `req.formData()`.
- **Auth:** toda ruta del panel usa `const auth = await requireUser(); if (auth.error) return auth.error;` (`lib/api-auth.ts`).
- **GHL:** hablar por REST vía helpers de `lib/ghl.ts` (nunca fetch directo desde la UI). El token sale de `GHL_PRIVATE_INTEGRATION`. Reusar `withRetry` y `GhlError` existentes.
- **Anthropic:** usar `anthropic` y `ANTHROPIC_MODEL` de `@/lib/anthropic`. Claude es opcional: si falla, el flujo continúa con un resumen calculado por código.
- **Idioma:** todos los textos de UI y mensajes al usuario en español neutro.
- **Path alias:** `@/*` → `./*` (tsconfig).
- **Mapeo determinista:** el mapeo columna→GHL es código, no lo decide el modelo. Las columnas son fijas.

---

## Estructura de archivos

| Archivo | Responsabilidad | Task |
|---|---|---|
| `vitest.config.ts` | Config de tests (env node, aliases `@` y `server-only`) | 1 |
| `tests/stubs/server-only.ts` | Stub vacío para `import 'server-only'` en tests | 1 |
| `lib/prospect-types.ts` | Tipo `RawProspect` (modelo interno único) | 2 |
| `lib/prospect-parser.ts` | Archivo → `RawProspect[]` (CSV y hoja "Manual Leads" del XLSX) | 2 |
| `lib/prospect-mapper.ts` | `RawProspect` → payloads GHL (tags, nota, custom fields, huella) | 3 |
| `lib/prospect-validator.ts` | Warnings por fila + métricas del lote | 4 |
| `lib/ghl.ts` (extender) | `searchContacts`, `createContact`, `updateContact`, `createNote`, `getPipelines`, `getCustomFields`, `createOpportunity` | 5 |
| `lib/prospect-summary.ts` | Resumen en español vía Claude (con fallback) | 6 |
| `app/api/contacts/import/route.ts` | Orquestación dryRun/real + reporte | 7 |
| `components/ContactImport.tsx` | UI del importador (dropzone, preview, reporte) | 8 |
| `components/Dashboard.tsx` (modificar) | Montar el modal de import | 8 |
| `components/AppHeader.tsx` (modificar) | Botón "Importar contactos" | 8 |

---

## Task 1: Setup de tests + dependencias

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/stubs/server-only.ts`
- Create: `lib/smoke.test.ts` (temporal, se borra al final del task)
- Modify: `package.json` (scripts + devDependencies)

**Interfaces:**
- Produces: infraestructura `npm test` (vitest) y la dependencia `xlsx` disponible para Task 2+.

- [ ] **Step 1: Instalar dependencias**

```bash
npm install xlsx
npm install -D vitest
```

- [ ] **Step 2: Crear el stub de `server-only`**

`lib/ghl.ts` y `lib/anthropic.ts` hacen `import 'server-only'`, que lanza fuera de un contexto RSC. El alias lo reemplaza por un módulo vacío en tests.

`tests/stubs/server-only.ts`:
```ts
export {};
```

- [ ] **Step 3: Crear `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
  resolve: {
    alias: {
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
      '@': path.resolve(import.meta.dirname),
    },
  },
});
```

- [ ] **Step 4: Agregar scripts a `package.json`**

En el bloque `"scripts"`, agregar:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 5: Escribir un smoke test**

`lib/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('setup', () => {
  it('corre vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Correr los tests (deben pasar)**

Run: `npm test`
Expected: PASS, 1 test (`setup > corre vitest`).

- [ ] **Step 7: Borrar el smoke test y commit**

```bash
rm lib/smoke.test.ts
git add package.json package-lock.json vitest.config.ts tests/stubs/server-only.ts
git commit -m "chore: setup de vitest + xlsx para el importador de contactos"
```

---

## Task 2: Parser de archivos (`lib/prospect-parser.ts`)

**Files:**
- Create: `lib/prospect-types.ts`
- Create: `lib/prospect-parser.ts`
- Create: `lib/prospect-parser.test.ts`
- Create: `tests/fixtures/prospects.csv` (copia del CSV real)
- Create: `tests/fixtures/prospects.xlsx` (copia del XLSX real)

**Interfaces:**
- Produces:
  - `type RawProspect` (30 campos string + `rowNumber: number`).
  - `parseProspectFile(data: Buffer | Uint8Array, filename: string): { format: 'csv' | 'xlsx'; prospects: RawProspect[] }`
  - Constantes `DEFAULT_SOURCE`, `DEFAULT_PIPELINE`, `DEFAULT_STAGE`.

- [ ] **Step 1: Copiar los archivos reales como fixtures**

```bash
mkdir -p tests/fixtures
cp "br_alto_import_contacts_toronto_gateway_batch1.csv" tests/fixtures/prospects.csv
cp "natural_lodge_b2b_prospecting_toronto_gateway_batch1_team_manual.xlsx" tests/fixtures/prospects.xlsx
```

- [ ] **Step 2: Crear el tipo `RawProspect`**

`lib/prospect-types.ts`:
```ts
/** Modelo interno único: el resto del sistema no sabe si vino de CSV o XLSX. */
export type RawProspect = {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  country: string;
  source: string;
  tagsRaw: string;
  pipeline: string;
  stage: string;
  leadScore: string;
  priority: string;
  leadType: string;
  pitchAngle: string;
  contactMethod: string;
  bestContactUrl: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  marketReach: string;
  activityLevel: string;
  contentFit: string;
  notes: string;
  firstAction: string;
  natureFit: string;
  evidence: string;
  confidence: string;
  leadId: string;
  /** Fila de datos 1-based (para el reporte). */
  rowNumber: number;
};
```

- [ ] **Step 3: Escribir el test del parser (debe fallar)**

`lib/prospect-parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseProspectFile } from './prospect-parser';

const fx = (name: string) => readFileSync(path.resolve(import.meta.dirname, '../tests/fixtures', name));

describe('parseProspectFile — CSV', () => {
  const { format, prospects } = parseProspectFile(fx('prospects.csv'), 'prospects.csv');

  it('detecta formato csv y 20 prospectos', () => {
    expect(format).toBe('csv');
    expect(prospects.length).toBe(20);
  });

  it('mapea nombre, empresa y tags crudos de la primera fila', () => {
    const p = prospects[0];
    expect(p.firstName).toBe('Julio');
    expect(p.lastName).toBe('Calas');
    expect(p.company).toBe('Anima Adventures / Nexion CA');
    expect(p.tagsRaw).toContain('B2B-Agent');
    expect(p.tagsRaw).toContain('Priority-A');
  });

  it('separa Notes en notes + firstAction por " | "', () => {
    const p = prospects[0];
    expect(p.notes).toContain('Very strong fit');
    expect(p.firstAction).toContain('Travel Leaders Email Me');
  });

  it('deja email/phone vacíos cuando no vienen', () => {
    expect(prospects[0].email).toBe('');
    expect(prospects[0].phone).toBe('');
  });
});

describe('parseProspectFile — XLSX (hoja Manual Leads)', () => {
  const { format, prospects } = parseProspectFile(fx('prospects.xlsx'), 'prospects.xlsx');

  it('detecta formato xlsx y 20 prospectos', () => {
    expect(format).toBe('xlsx');
    expect(prospects.length).toBe(20);
  });

  it('divide "Advisor" en nombre y apellido, y captura Lead ID', () => {
    const p = prospects[0];
    expect(p.firstName).toBe('Julio');
    expect(p.lastName).toBe('Calas');
    expect(p.leadId).toBe('TOR-001');
  });

  it('aplica pipeline/stage por defecto (no vienen en la hoja)', () => {
    expect(prospects[0].pipeline).toBe('Travel Agency Partnerships');
    expect(prospects[0].stage).toBe('New Prospect');
  });
});
```

- [ ] **Step 4: Correr el test (debe fallar)**

Run: `npm test -- prospect-parser`
Expected: FAIL — `parseProspectFile` no existe.

- [ ] **Step 5: Implementar el parser**

`lib/prospect-parser.ts`:
```ts
import * as XLSX from 'xlsx';
import type { RawProspect } from './prospect-types';

export const DEFAULT_SOURCE = 'B2B Prospecting - Import';
export const DEFAULT_PIPELINE = 'Travel Agency Partnerships';
export const DEFAULT_STAGE = 'New Prospect';
const XLSX_SHEET = 'Manual Leads';

const CSV_MAP: Record<string, keyof RawProspect> = {
  'First Name': 'firstName',
  'Last Name': 'lastName',
  'Company Name': 'company',
  Email: 'email',
  Phone: 'phone',
  Website: 'website',
  City: 'city',
  'State/Province': 'state',
  Country: 'country',
  'Lead Source': 'source',
  Tags: 'tagsRaw',
  Pipeline: 'pipeline',
  Stage: 'stage',
  'Lead Score': 'leadScore',
  Priority: 'priority',
  'Lead Type': 'leadType',
  'Pitch Angle': 'pitchAngle',
  'Contact Method': 'contactMethod',
  'Best Contact URL': 'bestContactUrl',
  Instagram: 'instagram',
  Facebook: 'facebook',
  LinkedIn: 'linkedin',
  'Market Reach': 'marketReach',
  'Activity Level': 'activityLevel',
  'Content Fit': 'contentFit',
  Notes: 'notes',
};

const XLSX_MAP: Record<string, keyof RawProspect> = {
  'Lead ID': 'leadId',
  Priority: 'priority',
  Score: 'leadScore',
  'Lead Type': 'leadType',
  Agency: 'company',
  City: 'city',
  Province: 'state',
  Country: 'country',
  Email: 'email',
  Phone: 'phone',
  Website: 'website',
  'Contact Method': 'contactMethod',
  'Best Contact URL': 'bestContactUrl',
  'Pitch Angle': 'pitchAngle',
  Instagram: 'instagram',
  Facebook: 'facebook',
  LinkedIn: 'linkedin',
  'Market Reach': 'marketReach',
  'Activity Level': 'activityLevel',
  'Content Fit': 'contentFit',
  Notes: 'notes',
  'First Action': 'firstAction',
  'Costa Rica Evidence': 'evidence',
  'Nature Fit': 'natureFit',
  Confidence: 'confidence',
  // 'Advisor' se maneja aparte (se divide en firstName/lastName)
};

function emptyProspect(rowNumber: number): RawProspect {
  return {
    firstName: '', lastName: '', company: '', email: '', phone: '', website: '',
    city: '', state: '', country: '', source: '', tagsRaw: '', pipeline: '', stage: '',
    leadScore: '', priority: '', leadType: '', pitchAngle: '', contactMethod: '',
    bestContactUrl: '', instagram: '', facebook: '', linkedin: '', marketReach: '',
    activityLevel: '', contentFit: '', notes: '', firstAction: '', natureFit: '',
    evidence: '', confidence: '', leadId: '', rowNumber,
  };
}

export type ParseResult = { format: 'csv' | 'xlsx'; prospects: RawProspect[] };

export function parseProspectFile(data: Buffer | Uint8Array, filename: string): ParseResult {
  const isCsv = filename.toLowerCase().endsWith('.csv');
  const wb = XLSX.read(data, { type: 'buffer' });

  let sheetName: string;
  if (isCsv) {
    sheetName = wb.SheetNames[0];
  } else {
    const found = wb.SheetNames.find((n) => n.trim().toLowerCase() === XLSX_SHEET.toLowerCase());
    if (!found) throw new Error(`El Excel no tiene la hoja "${XLSX_SHEET}"`);
    sheetName = found;
  }

  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
  if (!rows.length) throw new Error('El archivo está vacío');

  const header = (rows[0] as unknown[]).map((h) => String(h ?? '').trim());
  const map = isCsv ? CSV_MAP : XLSX_MAP;
  const advisorIdx = header.indexOf('Advisor');

  const prospects: RawProspect[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = (rows[i] as unknown[]).map((c) => String(c ?? '').trim());
    if (cells.every((c) => c === '')) continue;

    const p = emptyProspect(prospects.length + 1);
    for (let c = 0; c < header.length; c++) {
      const field = map[header[c]];
      if (field) (p[field] as string) = cells[c] ?? '';
    }

    if (!isCsv && advisorIdx >= 0) {
      const full = (cells[advisorIdx] ?? '').trim();
      const parts = full.split(/\s+/);
      p.firstName = parts[0] ?? '';
      p.lastName = parts.slice(1).join(' ');
    }

    if (isCsv && p.notes.includes(' | ')) {
      const [note, action] = p.notes.split(' | ');
      p.notes = (note ?? '').trim();
      p.firstAction = (action ?? '').trim();
    }

    if (!p.source) p.source = DEFAULT_SOURCE;
    if (!p.pipeline) p.pipeline = DEFAULT_PIPELINE;
    if (!p.stage) p.stage = DEFAULT_STAGE;

    prospects.push(p);
  }

  return { format: isCsv ? 'csv' : 'xlsx', prospects };
}
```

- [ ] **Step 6: Correr el test (debe pasar)**

Run: `npm test -- prospect-parser`
Expected: PASS, todos los casos.

- [ ] **Step 7: Commit**

```bash
git add lib/prospect-types.ts lib/prospect-parser.ts lib/prospect-parser.test.ts tests/fixtures/prospects.csv tests/fixtures/prospects.xlsx
git commit -m "feat: parser CSV/XLSX de prospectos a modelo interno"
```

---

## Task 3: Mapper a payloads GHL (`lib/prospect-mapper.ts`)

**Files:**
- Create: `lib/prospect-mapper.ts`
- Create: `lib/prospect-mapper.test.ts`

**Interfaces:**
- Consumes: `RawProspect` (Task 2).
- Produces:
  - `parseTags(tagsRaw: string): string[]`
  - `slugify(s: string): string`
  - `deriveBatchTag(sourceOrFilename: string): string`
  - `contactFingerprint(firstName, lastName, company): string`
  - `buildNote(raw: RawProspect): string`
  - `type MappedProspect`
  - `mapProspect(raw: RawProspect, batchTag: string): MappedProspect`

- [ ] **Step 1: Escribir el test (debe fallar)**

`lib/prospect-mapper.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { RawProspect } from './prospect-types';
import {
  parseTags, deriveBatchTag, contactFingerprint, mapProspect,
} from './prospect-mapper';

function makeRaw(over: Partial<RawProspect>): RawProspect {
  return {
    firstName: 'Julio', lastName: 'Calas', company: 'Anima Adventures', email: '', phone: '',
    website: '', city: 'Toronto', state: 'ON', country: 'Canada', source: 'B2B Prospecting - Toronto Gateway Batch 1',
    tagsRaw: 'B2B-Agent, Priority-A, Costa-Rica', pipeline: 'Travel Agency Partnerships', stage: 'New Prospect',
    leadScore: '9', priority: 'A', leadType: 'Advisor', pitchAngle: 'Nature extension', contactMethod: 'Travel Leaders',
    bestContactUrl: 'https://x', instagram: '@anima', facebook: '', linkedin: 'julio-calas',
    marketReach: 'Medium', activityLevel: 'Active', contentFit: 'High', notes: 'Very strong fit',
    firstAction: 'Email Me', natureFit: '', evidence: '', confidence: '', leadId: 'TOR-001', rowNumber: 1,
    ...over,
  };
}

describe('parseTags', () => {
  it('parte por coma y limpia espacios', () => {
    expect(parseTags('A, B ,C')).toEqual(['A', 'B', 'C']);
  });
  it('ignora vacíos', () => {
    expect(parseTags('A,,B, ')).toEqual(['A', 'B']);
  });
});

describe('deriveBatchTag', () => {
  it('slugifica el source y antepone Import-', () => {
    expect(deriveBatchTag('B2B Prospecting - Toronto Gateway Batch 1'))
      .toBe('Import-b2b-prospecting-toronto-gateway-batch-1');
  });
  it('quita la extensión de un filename', () => {
    expect(deriveBatchTag('prospects.csv')).toBe('Import-prospects');
  });
});

describe('contactFingerprint', () => {
  it('es estable ante mayúsculas/acentos/espacios', () => {
    expect(contactFingerprint('José', 'Pérez', 'Añó Tours'))
      .toBe(contactFingerprint(' jose ', 'perez', 'ano   tours'));
  });
});

describe('mapProspect', () => {
  it('agrega el batch tag y Contacto-Pendiente si no hay canal', () => {
    const m = mapProspect(makeRaw({ email: '', phone: '' }), 'Import-lote');
    expect(m.tags).toContain('Import-lote');
    expect(m.tags).toContain('Contacto-Pendiente');
    expect(m.hasContactChannel).toBe(false);
  });
  it('NO agrega Contacto-Pendiente si hay email', () => {
    const m = mapProspect(makeRaw({ email: 'a@b.com' }), 'Import-lote');
    expect(m.tags).not.toContain('Contacto-Pendiente');
    expect(m.hasContactChannel).toBe(true);
  });
  it('arma custom fields solo con valores no vacíos', () => {
    const m = mapProspect(makeRaw({ marketReach: '' }), 'Import-lote');
    const names = m.customFields.map((f) => f.name);
    expect(names).toContain('Lead Score');
    expect(names).toContain('Lead ID');
    expect(names).not.toContain('Market Reach');
  });
  it('la nota incluye prioridad, pitch y acción sugerida', () => {
    const m = mapProspect(makeRaw({}), 'Import-lote');
    expect(m.note).toContain('Prioridad: A');
    expect(m.note).toContain('Pitch: Nature extension');
    expect(m.note).toContain('Acción sugerida: Email Me');
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npm test -- prospect-mapper`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el mapper**

`lib/prospect-mapper.ts`:
```ts
import type { RawProspect } from './prospect-types';

export type MappedProspect = {
  raw: RawProspect;
  contact: {
    firstName: string; lastName: string; name: string; companyName: string;
    email: string; phone: string; website: string;
    city: string; state: string; country: string; source: string;
  };
  tags: string[];
  note: string;
  customFields: Array<{ name: string; value: string }>;
  opportunityName: string;
  fingerprint: string;
  hasContactChannel: boolean;
};

export function parseTags(tagsRaw: string): string[] {
  return tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function deriveBatchTag(sourceOrFilename: string): string {
  const slug = slugify(sourceOrFilename.replace(/\.(csv|xlsx)$/i, ''));
  return `Import-${slug}`;
}

export function contactFingerprint(firstName: string, lastName: string, company: string): string {
  return slugify(`${firstName} ${lastName} ${company}`);
}

export function buildNote(raw: RawProspect): string {
  const lines: string[] = [];
  const head = [
    raw.priority && `Prioridad: ${raw.priority}`,
    raw.leadScore && `Score: ${raw.leadScore}`,
    raw.leadType && `Tipo: ${raw.leadType}`,
  ].filter(Boolean).join('  ·  ');
  if (head) lines.push(head);
  if (raw.pitchAngle) lines.push(`Pitch: ${raw.pitchAngle}`);
  if (raw.firstAction) lines.push(`Acción sugerida: ${raw.firstAction}`);
  if (raw.contactMethod) lines.push(`Método: ${raw.contactMethod}`);
  const social = [
    raw.instagram && `IG ${raw.instagram}`,
    raw.facebook && `FB ${raw.facebook}`,
    raw.linkedin && `LinkedIn ${raw.linkedin}`,
  ].filter(Boolean).join(' · ');
  if (social) lines.push(`Redes: ${social}`);
  if (raw.natureFit) lines.push(`Nature Fit: ${raw.natureFit}`);
  if (raw.evidence) lines.push(`Evidencia: ${raw.evidence}`);
  if (raw.confidence) lines.push(`Confianza: ${raw.confidence}`);
  if (raw.notes) lines.push(`Notas: ${raw.notes}`);
  return lines.join('\n');
}

const CUSTOM_FIELD_MAP: Array<{ name: string; get: (r: RawProspect) => string }> = [
  { name: 'Lead Score', get: (r) => r.leadScore },
  { name: 'Priority', get: (r) => r.priority },
  { name: 'Lead Type', get: (r) => r.leadType },
  { name: 'Pitch Angle', get: (r) => r.pitchAngle },
  { name: 'Market Reach', get: (r) => r.marketReach },
  { name: 'Activity Level', get: (r) => r.activityLevel },
  { name: 'Content Fit', get: (r) => r.contentFit },
  { name: 'Best Contact URL', get: (r) => r.bestContactUrl },
  { name: 'Lead ID', get: (r) => r.leadId },
];

export function mapProspect(raw: RawProspect, batchTag: string): MappedProspect {
  const tags = parseTags(raw.tagsRaw);
  if (batchTag && !tags.includes(batchTag)) tags.push(batchTag);

  const hasContactChannel = Boolean(raw.email || raw.phone);
  if (!hasContactChannel) tags.push('Contacto-Pendiente');

  const customFields = CUSTOM_FIELD_MAP
    .map((f) => ({ name: f.name, value: f.get(raw) }))
    .filter((f) => f.value !== '');

  const name = [raw.firstName, raw.lastName].filter(Boolean).join(' ').trim();

  return {
    raw,
    contact: {
      firstName: raw.firstName,
      lastName: raw.lastName,
      name: name || raw.company,
      companyName: raw.company,
      email: raw.email,
      phone: raw.phone,
      website: raw.website,
      city: raw.city,
      state: raw.state,
      country: raw.country,
      source: raw.source,
    },
    tags,
    note: buildNote(raw),
    customFields,
    opportunityName: raw.company || name || 'Prospecto',
    fingerprint: contactFingerprint(raw.firstName, raw.lastName, raw.company),
    hasContactChannel,
  };
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npm test -- prospect-mapper`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/prospect-mapper.ts lib/prospect-mapper.test.ts
git commit -m "feat: mapper de prospecto a payloads GHL (tags, nota, custom fields, huella)"
```

---

## Task 4: Validador y métricas (`lib/prospect-validator.ts`)

**Files:**
- Create: `lib/prospect-validator.ts`
- Create: `lib/prospect-validator.test.ts`

**Interfaces:**
- Consumes: `RawProspect` (Task 2).
- Produces:
  - `type RowValidation = { rowNumber: number; warnings: string[] }`
  - `type BatchMetrics = { total; withChannel; withoutChannel; withEmail; withPhone; invalidEmails }` (todos `number`)
  - `validateProspects(rows: RawProspect[]): { validations: RowValidation[]; metrics: BatchMetrics }`

- [ ] **Step 1: Escribir el test (debe fallar)**

`lib/prospect-validator.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { RawProspect } from './prospect-types';
import { validateProspects } from './prospect-validator';

function raw(over: Partial<RawProspect>, rowNumber: number): RawProspect {
  return {
    firstName: 'A', lastName: 'B', company: 'C', email: '', phone: '', website: '', city: '',
    state: '', country: '', source: '', tagsRaw: '', pipeline: '', stage: '', leadScore: '',
    priority: '', leadType: '', pitchAngle: '', contactMethod: '', bestContactUrl: '',
    instagram: '', facebook: '', linkedin: '', marketReach: '', activityLevel: '', contentFit: '',
    notes: '', firstAction: '', natureFit: '', evidence: '', confidence: '', leadId: '', rowNumber,
    ...over,
  };
}

describe('validateProspects', () => {
  const rows = [
    raw({ email: 'good@x.com' }, 1),
    raw({ email: 'bad-email', phone: '' }, 2),
    raw({ email: '', phone: '' }, 3),
    raw({ phone: '555-1234' }, 4),
  ];
  const { validations, metrics } = validateProspects(rows);

  it('cuenta totales y canales', () => {
    expect(metrics.total).toBe(4);
    expect(metrics.withEmail).toBe(1);
    expect(metrics.withPhone).toBe(1);
    expect(metrics.invalidEmails).toBe(1);
    expect(metrics.withoutChannel).toBe(1);
  });

  it('marca correo inválido', () => {
    expect(validations[1].warnings.join()).toContain('inválido');
  });

  it('marca fila sin canal de contacto', () => {
    expect(validations[2].warnings.join()).toContain('Sin correo ni teléfono');
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npm test -- prospect-validator`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el validador**

`lib/prospect-validator.ts`:
```ts
import type { RawProspect } from './prospect-types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RowValidation = { rowNumber: number; warnings: string[] };

export type BatchMetrics = {
  total: number;
  withChannel: number;
  withoutChannel: number;
  withEmail: number;
  withPhone: number;
  invalidEmails: number;
};

export function validateProspects(rows: RawProspect[]): {
  validations: RowValidation[];
  metrics: BatchMetrics;
} {
  const validations: RowValidation[] = [];
  let withChannel = 0;
  let withEmail = 0;
  let withPhone = 0;
  let invalidEmails = 0;

  for (const r of rows) {
    const warnings: string[] = [];
    const hasEmail = Boolean(r.email);
    const hasPhone = Boolean(r.phone);
    const emailValid = hasEmail && EMAIL_RE.test(r.email);

    if (hasEmail && !emailValid) {
      warnings.push('Correo con formato inválido');
      invalidEmails++;
    }
    if (emailValid) withEmail++;
    if (hasPhone) withPhone++;

    if (!hasEmail && !hasPhone) {
      warnings.push('Sin correo ni teléfono (quedará marcado como pendiente)');
    } else {
      withChannel++;
    }

    if (!r.firstName && !r.lastName && !r.company) {
      warnings.push('Sin nombre ni empresa');
    }

    validations.push({ rowNumber: r.rowNumber, warnings });
  }

  return {
    validations,
    metrics: {
      total: rows.length,
      withChannel,
      withoutChannel: rows.length - withChannel,
      withEmail,
      withPhone,
      invalidEmails,
    },
  };
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npm test -- prospect-validator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/prospect-validator.ts lib/prospect-validator.test.ts
git commit -m "feat: validador de prospectos + métricas del lote"
```

---

## Task 5: Extender `lib/ghl.ts` con las llamadas del importador

**Files:**
- Modify: `lib/ghl.ts` (agregar tipo `companyName` a `GhlContact`; agregar funciones nuevas al final)
- Create: `lib/ghl-importer.test.ts`

**Interfaces:**
- Consumes: helpers internos existentes `ghlFetch`, `withRetry`, `GhlError`, `GHL_LOCATION_ID`.
- Produces:
  - `type GhlContactFields`
  - `searchContacts(input: { query: string; locationId?: string }): Promise<GhlContact[]>`
  - `createContact(input: GhlContactFields): Promise<GhlContact>`
  - `updateContact(contactId: string, input: GhlContactFields): Promise<GhlContact>`
  - `createNote(contactId: string, body: string, locationId?: string): Promise<void>`
  - `type GhlPipeline`, `getPipelines(locationId?: string): Promise<GhlPipeline[]>`
  - `type GhlCustomField`, `getCustomFields(locationId?: string): Promise<GhlCustomField[]>`
  - `createOpportunity(input): Promise<{ id: string }>`

- [ ] **Step 1: Agregar `companyName` al tipo `GhlContact`**

En `lib/ghl.ts`, en la definición de `export type GhlContact = { ... }`, agregar la línea:
```ts
  companyName?: string;
```

- [ ] **Step 2: Escribir el test con `fetch` mockeado (debe fallar)**

`lib/ghl-importer.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV, GHL_PRIVATE_INTEGRATION: 'test-token', GHL_LOCATION_ID: 'LOC1' };
});
afterEach(() => {
  process.env = OLD_ENV;
  vi.restoreAllMocks();
});

function mockFetch(jsonBody: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(jsonBody), { status: 200 }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('createContact', () => {
  it('hace POST a /contacts/ con locationId y limpia campos vacíos', async () => {
    const spy = mockFetch({ contact: { id: 'c1' } });
    const { createContact } = await import('./ghl');
    const c = await createContact({ firstName: 'Julio', company: '', email: 'a@b.com' } as never);
    expect(c.id).toBe('c1');
    const [url, opts] = spy.mock.calls[0];
    expect(String(url)).toContain('/contacts/');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.locationId).toBe('LOC1');
    expect(body.firstName).toBe('Julio');
    expect('company' in body).toBe(false); // vacío se omite
  });
});

describe('searchContacts', () => {
  it('hace GET a /contacts/ con query', async () => {
    const spy = mockFetch({ contacts: [{ id: 'c1', email: 'a@b.com' }] });
    const { searchContacts } = await import('./ghl');
    const res = await searchContacts({ query: 'a@b.com' });
    expect(res[0].id).toBe('c1');
    expect(String(spy.mock.calls[0][0])).toContain('query=a%40b.com');
  });
});

describe('createOpportunity', () => {
  it('POST a /opportunities/ y devuelve id', async () => {
    const spy = mockFetch({ opportunity: { id: 'o1' } });
    const { createOpportunity } = await import('./ghl');
    const o = await createOpportunity({ pipelineId: 'p1', stageId: 's1', name: 'X', contactId: 'c1' });
    expect(o.id).toBe('o1');
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.pipelineStageId).toBe('s1');
    expect(body.status).toBe('open');
  });
});

describe('getPipelines', () => {
  it('devuelve el array de pipelines', async () => {
    mockFetch({ pipelines: [{ id: 'p1', name: 'Travel Agency Partnerships', stages: [] }] });
    const { getPipelines } = await import('./ghl');
    const ps = await getPipelines();
    expect(ps[0].name).toBe('Travel Agency Partnerships');
  });
});
```

> Nota: `await import('./ghl')` (import dinámico) permite que cada test tenga el `fetch` ya stubbeado antes de que el módulo lea el token.

- [ ] **Step 3: Correr el test (debe fallar)**

Run: `npm test -- ghl-importer`
Expected: FAIL — funciones no existen.

- [ ] **Step 4: Agregar las funciones al final de `lib/ghl.ts`**

```ts
// ── Importador de contactos ──────────────────────────────────────

export type GhlContactFields = {
  firstName?: string;
  lastName?: string;
  name?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  website?: string;
  city?: string;
  state?: string;
  country?: string;
  source?: string;
  customFields?: Array<{ id: string; field_value: string }>;
  locationId?: string;
};

/** Quita claves undefined/'' y arrays vacíos, para no pisar datos en GHL. */
function cleanBody<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export async function searchContacts(input: {
  query: string;
  locationId?: string;
}): Promise<GhlContact[]> {
  const data = await withRetry(() =>
    ghlFetch<{ contacts?: GhlContact[] }>('/contacts/', {
      version: '2021-07-28',
      query: {
        locationId: input.locationId || GHL_LOCATION_ID,
        query: input.query,
        limit: 20,
      },
    }),
  );
  return data.contacts ?? [];
}

export async function createContact(input: GhlContactFields): Promise<GhlContact> {
  const { locationId, ...rest } = input;
  const data = await withRetry(() =>
    ghlFetch<{ contact: GhlContact }>('/contacts/', {
      method: 'POST',
      version: '2021-07-28',
      body: cleanBody({ locationId: locationId || GHL_LOCATION_ID, ...rest }),
    }),
  );
  return data.contact;
}

export async function updateContact(
  contactId: string,
  input: GhlContactFields,
): Promise<GhlContact> {
  const { locationId: _ignored, ...rest } = input;
  const data = await withRetry(() =>
    ghlFetch<{ contact: GhlContact }>(`/contacts/${contactId}`, {
      method: 'PUT',
      version: '2021-07-28',
      body: cleanBody(rest),
    }),
  );
  return data.contact;
}

export async function createNote(
  contactId: string,
  body: string,
  _locationId: string = GHL_LOCATION_ID,
): Promise<void> {
  await withRetry(() =>
    ghlFetch(`/contacts/${contactId}/notes`, {
      method: 'POST',
      version: '2021-07-28',
      body: { body },
    }),
  );
}

export type GhlPipeline = {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
};

export async function getPipelines(locationId: string = GHL_LOCATION_ID): Promise<GhlPipeline[]> {
  const data = await withRetry(() =>
    ghlFetch<{ pipelines?: GhlPipeline[] }>('/opportunities/pipelines', {
      version: '2021-07-28',
      query: { locationId },
    }),
  );
  return data.pipelines ?? [];
}

export type GhlCustomField = {
  id: string;
  name: string;
  fieldKey?: string;
  dataType?: string;
};

export async function getCustomFields(
  locationId: string = GHL_LOCATION_ID,
): Promise<GhlCustomField[]> {
  const data = await withRetry(() =>
    ghlFetch<{ customFields?: GhlCustomField[] }>(`/locations/${locationId}/customFields`, {
      version: '2021-07-28',
    }),
  );
  return data.customFields ?? [];
}

export async function createOpportunity(input: {
  pipelineId: string;
  stageId: string;
  name: string;
  contactId: string;
  status?: string;
  monetaryValue?: number;
  locationId?: string;
}): Promise<{ id: string }> {
  const data = await withRetry(() =>
    ghlFetch<{ opportunity?: { id: string }; id?: string }>('/opportunities/', {
      method: 'POST',
      version: '2021-07-28',
      body: {
        pipelineId: input.pipelineId,
        locationId: input.locationId || GHL_LOCATION_ID,
        name: input.name,
        pipelineStageId: input.stageId,
        status: input.status || 'open',
        contactId: input.contactId,
        monetaryValue: input.monetaryValue ?? 0,
      },
    }),
  );
  const id = data.opportunity?.id || data.id;
  if (!id) throw new GhlError(200, JSON.stringify(data).slice(0, 300), '/opportunities/ (sin id)');
  return { id };
}
```

- [ ] **Step 5: Correr el test (debe pasar)**

Run: `npm test -- ghl-importer`
Expected: PASS.

- [ ] **Step 6: Verificar tipos y commit**

Run: `npx tsc --noEmit`
Expected: sin errores.

```bash
git add lib/ghl.ts lib/ghl-importer.test.ts
git commit -m "feat(ghl): search/create/update contactos, notas, pipelines, custom fields, oportunidades"
```

---

## Task 6: Resumen con Claude (`lib/prospect-summary.ts`)

**Files:**
- Create: `lib/prospect-summary.ts`
- Create: `lib/prospect-summary.test.ts`

**Interfaces:**
- Consumes: `BatchMetrics` (Task 4); `anthropic`, `ANTHROPIC_MODEL` de `@/lib/anthropic`.
- Produces:
  - `type ImportSummary = { text: string; alerts: string[] }`
  - `summarizeBatch(input: { metrics: BatchMetrics; sampleWarnings: string[] }): Promise<ImportSummary>`

- [ ] **Step 1: Escribir el test con anthropic mockeado (debe fallar)**

`lib/prospect-summary.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BatchMetrics } from './prospect-validator';

const create = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create } },
  ANTHROPIC_MODEL: 'test-model',
}));

const metrics: BatchMetrics = {
  total: 20, withChannel: 5, withoutChannel: 15, withEmail: 2, withPhone: 4, invalidEmails: 1,
};

beforeEach(() => create.mockReset());

describe('summarizeBatch', () => {
  it('usa el texto de Claude cuando responde', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'Resumen de Claude.' }] });
    const { summarizeBatch } = await import('./prospect-summary');
    const s = await summarizeBatch({ metrics, sampleWarnings: [] });
    expect(s.text).toBe('Resumen de Claude.');
    expect(s.alerts).toContain('1 correo(s) con formato inválido');
    expect(s.alerts).toContain('15 sin correo ni teléfono');
  });

  it('cae al resumen calculado si Claude falla', async () => {
    create.mockRejectedValue(new Error('sin API key'));
    const { summarizeBatch } = await import('./prospect-summary');
    const s = await summarizeBatch({ metrics, sampleWarnings: [] });
    expect(s.text).toContain('20 contactos');
    expect(s.text).toContain('15 sin datos de contacto');
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npm test -- prospect-summary`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el módulo**

`lib/prospect-summary.ts`:
```ts
import { anthropic, ANTHROPIC_MODEL } from '@/lib/anthropic';
import type { BatchMetrics } from './prospect-validator';

export type ImportSummary = { text: string; alerts: string[] };

function fallbackText(m: BatchMetrics): string {
  return (
    `${m.total} contactos encontrados. ${m.withChannel} con correo o teléfono, ` +
    `${m.withoutChannel} sin datos de contacto (se marcarán como pendientes).`
  );
}

export async function summarizeBatch(input: {
  metrics: BatchMetrics;
  sampleWarnings: string[];
}): Promise<ImportSummary> {
  const { metrics, sampleWarnings } = input;

  const alerts: string[] = [];
  if (metrics.invalidEmails > 0) alerts.push(`${metrics.invalidEmails} correo(s) con formato inválido`);
  if (metrics.withoutChannel > 0) alerts.push(`${metrics.withoutChannel} sin correo ni teléfono`);

  try {
    const msg = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system:
        'Sos un asistente que resume lotes de contactos para un equipo NO técnico de un lodge en Costa Rica. ' +
        'Devolvé 2-3 frases claras en español neutro, sin markdown, describiendo qué se va a importar y cualquier alerta. ' +
        'No inventes datos: usá solo las métricas dadas.',
      messages: [
        {
          role: 'user',
          content:
            `Métricas del lote:\n${JSON.stringify(metrics, null, 2)}\n\n` +
            `Alertas detectadas:\n${sampleWarnings.join('\n') || '(ninguna)'}`,
        },
      ],
    });

    const text = msg.content
      .filter((b: { type: string }): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return { text: text || fallbackText(metrics), alerts };
  } catch {
    return { text: fallbackText(metrics), alerts };
  }
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npm test -- prospect-summary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/prospect-summary.ts lib/prospect-summary.test.ts
git commit -m "feat: resumen del lote con Claude y fallback calculado"
```

---

## Task 7: Ruta de importación (`app/api/contacts/import/route.ts`)

**Files:**
- Create: `app/api/contacts/import/route.ts`
- Create: `app/api/contacts/import/route.test.ts`

**Interfaces:**
- Consumes: todo lo anterior + `requireUser` (`@/lib/api-auth`), `addContactTags` (existente).
- Produces: endpoint `POST /api/contacts/import`.
  - **dryRun** (`?dryRun=1`): `{ ok: true, format, metrics, summary, preview: PreviewRow[] }`
    - `PreviewRow = { rowNumber; name; company; email; phone; tags: string[]; hasContactChannel; warnings: string[] }`
  - **real**: `{ ok: true, report }` con `report = { created; updated; failed: Array<{ rowNumber; name; reason }>; missingCustomFields: string[]; pipelineResolved: boolean }`

- [ ] **Step 1: Leer la doc de Next sobre Route Handlers**

Run: `ls node_modules/next/dist/docs/01-app` y abrir la sección de Route Handlers / Request. Confirmar la firma `POST(req: Request)` y `await req.formData()` en esta versión.

- [ ] **Step 2: Escribir el test con los libs mockeados (debe fallar)**

`app/api/contacts/import/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(async () => ({ user: { email: 'x@y.com' }, error: null })),
}));

const ghl = {
  searchContacts: vi.fn(async () => []),
  createContact: vi.fn(async () => ({ id: 'c1' })),
  updateContact: vi.fn(async () => ({ id: 'c1' })),
  createNote: vi.fn(async () => {}),
  createOpportunity: vi.fn(async () => ({ id: 'o1' })),
  getPipelines: vi.fn(async () => [{ id: 'p1', name: 'Travel Agency Partnerships', stages: [{ id: 's1', name: 'New Prospect' }] }]),
  getCustomFields: vi.fn(async () => [{ id: 'f1', name: 'Lead Score' }]),
  addContactTags: vi.fn(async () => {}),
};
vi.mock('@/lib/ghl', () => ghl);

vi.mock('@/lib/prospect-summary', () => ({
  summarizeBatch: vi.fn(async () => ({ text: 'resumen', alerts: [] })),
}));

import { readFileSync } from 'node:fs';
import path from 'node:path';

function req(fileName: string, dryRun: boolean): Request {
  const buf = readFileSync(path.resolve(import.meta.dirname, '../../../../tests/fixtures', fileName));
  const form = new FormData();
  form.set('file', new File([buf], fileName));
  const url = `http://t/api/contacts/import${dryRun ? '?dryRun=1' : ''}`;
  return new Request(url, { method: 'POST', body: form });
}

beforeEach(() => Object.values(ghl).forEach((f) => f.mockClear?.()));

describe('POST /api/contacts/import', () => {
  it('dryRun devuelve preview y NO toca GHL', async () => {
    const { POST } = await import('./route');
    const res = await POST(req('prospects.csv', true));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.preview.length).toBe(20);
    expect(body.metrics.total).toBe(20);
    expect(ghl.createContact).not.toHaveBeenCalled();
  });

  it('ejecución real crea contactos, tags, nota y oportunidad', async () => {
    const { POST } = await import('./route');
    const res = await POST(req('prospects.csv', false));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.report.created).toBe(20);
    expect(ghl.createContact).toHaveBeenCalledTimes(20);
    expect(ghl.addContactTags).toHaveBeenCalledTimes(20);
    expect(ghl.createNote).toHaveBeenCalledTimes(20);
    expect(ghl.createOpportunity).toHaveBeenCalledTimes(20);
    expect(body.report.pipelineResolved).toBe(true);
  });

  it('un fallo por fila no aborta el lote', async () => {
    ghl.createContact.mockRejectedValueOnce(new Error('GHL 500'));
    const { POST } = await import('./route');
    const res = await POST(req('prospects.csv', false));
    const body = await res.json();
    expect(body.report.failed.length).toBe(1);
    expect(body.report.created).toBe(19);
  });
});
```

- [ ] **Step 3: Correr el test (debe fallar)**

Run: `npm test -- contacts/import`
Expected: FAIL — la ruta no existe.

- [ ] **Step 4: Implementar la ruta**

`app/api/contacts/import/route.ts`:
```ts
import { requireUser } from '@/lib/api-auth';
import { parseProspectFile, DEFAULT_PIPELINE, DEFAULT_STAGE } from '@/lib/prospect-parser';
import { validateProspects } from '@/lib/prospect-validator';
import { mapProspect, deriveBatchTag, contactFingerprint, type MappedProspect } from '@/lib/prospect-mapper';
import { summarizeBatch } from '@/lib/prospect-summary';
import {
  searchContacts, createContact, updateContact, createNote, createOpportunity,
  getPipelines, getCustomFields, addContactTags, type GhlContact,
} from '@/lib/ghl';

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
  const batchTag = deriveBatchTag(prospects[0].source || file.name);
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
    return Response.json({ ok: true, format, metrics, summary, preview });
  }

  // ── Ejecución real ──
  const report = {
    created: 0,
    updated: 0,
    failed: [] as Array<{ rowNumber: number; name: string; reason: string }>,
    missingCustomFields: [] as string[],
    pipelineResolved: false,
  };

  // Resolver IDs una sola vez (con degradación elegante).
  const cfByName = new Map<string, string>();
  try {
    for (const f of await getCustomFields()) cfByName.set(f.name.trim().toLowerCase(), f.id);
  } catch {
    /* sin custom fields: se reportan como faltantes abajo */
  }

  let pipelineId = '';
  let stageId = '';
  try {
    const wantPipe = (prospects[0].pipeline || DEFAULT_PIPELINE).trim().toLowerCase();
    const wantStage = (prospects[0].stage || DEFAULT_STAGE).trim().toLowerCase();
    const pipe = (await getPipelines()).find((p) => p.name.trim().toLowerCase() === wantPipe);
    if (pipe) {
      pipelineId = pipe.id;
      const stage = pipe.stages.find((s) => s.name.trim().toLowerCase() === wantStage) || pipe.stages[0];
      stageId = stage?.id || '';
      report.pipelineResolved = Boolean(pipelineId && stageId);
    }
  } catch {
    /* sin pipeline: no se crean oportunidades */
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
      if (existing) {
        const c = await updateContact(existing.id, fields);
        contactId = c.id;
        report.updated++;
      } else {
        const c = await createContact(fields);
        contactId = c.id;
        report.created++;
      }

      if (m.tags.length) await addContactTags(contactId, m.tags);
      if (m.note) await createNote(contactId, m.note);
      if (report.pipelineResolved) {
        await createOpportunity({ pipelineId, stageId, name: m.opportunityName, contactId });
      }
    } catch (e) {
      report.failed.push({
        rowNumber: m.raw.rowNumber,
        name: m.contact.name,
        reason: (e as Error).message,
      });
    }
  }

  report.missingCustomFields = [...missing];
  return Response.json({ ok: true, report });
}

/** Busca un contacto ya existente para evitar duplicados. */
async function findExisting(m: MappedProspect): Promise<GhlContact | null> {
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
    const norm = (s: string) => s.replace(/\D/g, '');
    const target = norm(m.contact.phone);
    return results.find((c) => norm(c.phone || '') !== '' && norm(c.phone || '') === target) || null;
  }
  // Sin canal: huella nombre+empresa.
  return (
    results.find(
      (c) => contactFingerprint(c.firstName || '', c.lastName || '', c.companyName || '') === m.fingerprint,
    ) || null
  );
}
```

- [ ] **Step 5: Correr el test (debe pasar)**

Run: `npm test -- contacts/import`
Expected: PASS (3 casos).

- [ ] **Step 6: Verificar tipos y commit**

Run: `npx tsc --noEmit`
Expected: sin errores.

```bash
git add app/api/contacts/import/route.ts app/api/contacts/import/route.test.ts
git commit -m "feat: ruta /api/contacts/import (dryRun + ejecución con dedup y reporte)"
```

---

## Task 8: UI del importador + integración en el panel

**Files:**
- Create: `components/ContactImport.tsx`
- Modify: `components/AppHeader.tsx` (nuevo botón + prop `onOpenImport`)
- Modify: `components/Dashboard.tsx` (estado + modal)

**Interfaces:**
- Consumes: endpoint `POST /api/contacts/import`.
- Produces: componente `ContactImport` y el botón "Importar contactos" en el header.

- [ ] **Step 1: Crear el componente `ContactImport.tsx`**

`components/ContactImport.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

type PreviewRow = {
  rowNumber: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  tags: string[];
  hasContactChannel: boolean;
  warnings: string[];
};
type Metrics = {
  total: number; withChannel: number; withoutChannel: number;
  withEmail: number; withPhone: number; invalidEmails: number;
};
type Preview = {
  ok: true; format: string; metrics: Metrics;
  summary: { text: string; alerts: string[] }; preview: PreviewRow[];
};
type Report = {
  created: number; updated: number;
  failed: Array<{ rowNumber: number; name: string; reason: string }>;
  missingCustomFields: string[]; pipelineResolved: boolean;
};

type Phase = 'idle' | 'previewing' | 'preview' | 'importing' | 'done' | 'error';

export function ContactImport() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string>('');

  async function post(f: File, dryRun: boolean) {
    const form = new FormData();
    form.set('file', f);
    const res = await fetch(`/api/contacts/import${dryRun ? '?dryRun=1' : ''}`, {
      method: 'POST',
      body: form,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Error inesperado');
    return body;
  }

  async function onFile(f: File) {
    setFile(f);
    setError('');
    setPhase('previewing');
    try {
      setPreview(await post(f, true));
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
      const body = await post(file, false);
      setReport(body.report);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }

  function reset() {
    setPhase('idle');
    setFile(null);
    setPreview(null);
    setReport(null);
    setError('');
  }

  return (
    <div className="text-[--color-cream] text-[14px]">
      {(phase === 'idle' || phase === 'previewing') && (
        <label className="glass flex flex-col items-center justify-center gap-3 py-10 px-6 rounded-2xl cursor-pointer text-center">
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
                        {r.hasContactChannel ? (
                          r.email || r.phone
                        ) : (
                          <span className="text-amber-300">Pendiente</span>
                        )}
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
          <div>Importando a GoHighLevel…</div>
        </div>
      )}

      {phase === 'done' && report && (
        <div className="flex flex-col gap-3">
          <div className="glass rounded-2xl p-5 flex items-start gap-3">
            <CheckCircle2 className="text-[--color-green-glow] mt-0.5" size={22} />
            <div>
              <div className="font-medium">Importación completa</div>
              <div className="text-[13px] text-[--color-cream-mute] mt-1">
                {report.created} creados · {report.updated} ya existían y se actualizaron
                {report.failed.length > 0 && ` · ${report.failed.length} con error`}
              </div>
              {!report.pipelineResolved && (
                <div className="text-[12px] text-amber-300 mt-2">
                  No se encontró el pipeline en GHL: no se crearon oportunidades.
                </div>
              )}
              {report.missingCustomFields.length > 0 && (
                <div className="text-[12px] text-amber-300 mt-1">
                  Campos no encontrados en GHL (no se llenaron): {report.missingCustomFields.join(', ')}
                </div>
              )}
            </div>
          </div>
          {report.failed.length > 0 && (
            <div className="glass rounded-2xl p-4 text-[12.5px]">
              <div className="font-medium mb-2">Filas con error</div>
              <ul className="flex flex-col gap-1">
                {report.failed.map((f) => (
                  <li key={f.rowNumber} className="text-[--color-cream-mute]">
                    Fila {f.rowNumber} ({f.name}): {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
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

- [ ] **Step 2: Agregar el botón al `AppHeader`**

En `components/AppHeader.tsx`:

1. Cambiar el import de iconos:
```tsx
import { LogOut, Sparkles, MessageSquare, Upload } from 'lucide-react';
```
2. Agregar `onOpenImport` a las props (tipo y destructuring):
```tsx
  onOpenImport,
```
```tsx
  onOpenImport: () => void;
```
3. Agregar el pill antes del de "Asistente IA", dentro del `div` de acciones:
```tsx
        <HeaderPill onClick={onOpenImport} icon={<Upload size={14} />}>
          <span className="hidden sm:inline">Importar contactos</span>
        </HeaderPill>
```

- [ ] **Step 3: Montar el modal en `Dashboard`**

En `components/Dashboard.tsx`:

1. Agregar el import:
```tsx
import { ContactImport } from './ContactImport';
```
2. Agregar estado junto a los otros `useState`:
```tsx
  const [importOpen, setImportOpen] = useState(false);
```
3. Pasar la prop al header:
```tsx
        <AppHeader
          email={user?.email || null}
          onSignOut={handleSignOut}
          onOpenAssistant={() => setAssistantOpen(true)}
          onOpenTester={() => setTesterOpen(true)}
          onOpenImport={() => setImportOpen(true)}
        />
```
4. Agregar el modal junto al de "Asistente" (antes del `</>` de cierre):
```tsx
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar contactos"
        subtitle="Subí el archivo de prospectos (CSV o Excel). Verás un resumen y confirmás antes de crear en GoHighLevel."
      >
        <ContactImport />
      </Modal>
```

- [ ] **Step 4: Verificar tipos y build**

Run: `npx tsc --noEmit && npm run build`
Expected: compila sin errores.

- [ ] **Step 5: Verificación manual en el navegador**

Run: `npm run dev`
- Abrir el panel, click en "Importar contactos".
- Subir `tests/fixtures/prospects.csv` → aparece resumen + tabla con 20 filas.
- (Opcional, contra un GHL de prueba) confirmar y ver el reporte final.
Expected: el flujo subir → previsualizar → confirmar funciona; los contactos sin email/phone aparecen como "Pendiente".

- [ ] **Step 6: Commit**

```bash
git add components/ContactImport.tsx components/AppHeader.tsx components/Dashboard.tsx
git commit -m "feat: UI del importador de contactos en el panel"
```

---

## Notas de despliegue (no son tasks de código)

- **Custom fields en GHL:** para que se llenen, deben existir en GHL con estos nombres exactos: `Lead Score`, `Priority`, `Lead Type`, `Pitch Angle`, `Market Reach`, `Activity Level`, `Content Fit`, `Best Contact URL`, `Lead ID`. Si no existen, el import igual crea contacto/tags/nota/oportunidad y los lista en el reporte como "no encontrados".
- **Pipeline en GHL:** debe existir un pipeline llamado `Travel Agency Partnerships` con una etapa `New Prospect`. Si no, no se crean oportunidades (se avisa en el reporte).
- **Variables de entorno:** ya presentes (`GHL_PRIVATE_INTEGRATION`, `GHL_LOCATION_ID`, `ANTHROPIC_API_KEY`). No se agregan nuevas.

---

## Self-Review (autor)

**Cobertura del spec:**
- §1 flujo subir→previsualizar→confirmar → Task 7 (dryRun/real) + Task 8 (UI). ✔
- §2 parseo CSV + hoja "Manual Leads" del XLSX → Task 2. ✔
- §3 arquitectura y módulos → Tasks 2–8. ✔
- §4 mapeo (contacto, tags, nota, custom fields, oportunidad) → Task 3 (payloads) + Task 5 (ghl) + Task 7 (orquestación). ✔
- §4.1 descubrimiento de IDs con degradación elegante → Task 7 (getPipelines/getCustomFields + missingCustomFields/pipelineResolved). ✔
- §5 rol de Claude (resumen + fallback) → Task 6. ✔
- §6 dedup (email/phone/huella) → Task 7 `findExisting` + Task 3 `contactFingerprint`. ✔
- §7 sin canal → crear + tag `Contacto-Pendiente` → Task 3 `mapProspect`. ✔
- §8 errores (parseo 422, por-fila no aborta, reporte) → Task 7. ✔
- §10 pruebas → tests en Tasks 2–7. ✔

**Sin placeholders:** todo el código está completo; no hay TODO/TBD.

**Consistencia de tipos:** `RawProspect` (Task 2) se consume idéntico en Tasks 3/4; `MappedProspect`, `contactFingerprint`, `BatchMetrics`, `ImportSummary`, `GhlContactFields` usan las mismas firmas entre tasks. `addContactTags` es preexistente y se reusa en Task 7.
