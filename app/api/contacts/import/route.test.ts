import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GhlContact } from '@/lib/ghl';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(async () => ({ user: { email: 'x@y.com' }, error: null })),
}));

const ghl = {
  searchContacts: vi.fn(async (): Promise<GhlContact[]> => []),
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

beforeEach(() => {
  Object.values(ghl).forEach((f) => f.mockClear?.());
  // Reset return values that individual tests may override, so nothing bleeds
  // into the next test (mockClear() only resets call history, not implementation).
  ghl.searchContacts.mockResolvedValue([]);
});

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
    // getCustomFields mock only resolves "Lead Score"; the mapper also emits
    // "Priority" (among others), which should be collected as missing.
    expect(body.report.missingCustomFields).toContain('Priority');
  });

  it('un fallo por fila no aborta el lote', async () => {
    ghl.createContact.mockRejectedValueOnce(new Error('GHL 500'));
    const { POST } = await import('./route');
    const res = await POST(req('prospects.csv', false));
    const body = await res.json();
    expect(body.report.failed.length).toBe(1);
    expect(body.report.created).toBe(19);
  });

  it('dedup por correo: el contacto existente se reporta como duplicado, el resto se crea', async () => {
    ghl.searchContacts.mockResolvedValue([
      {
        id: 'existing-cindy',
        email: 'cworsley@thetravelagentnextdoor.com',
        phone: '',
        firstName: 'Cindy',
        lastName: 'Worsley',
        companyName: 'The Travel Agent Next Door',
      },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req('prospects.csv', false));
    const body = await res.json();
    expect(ghl.updateContact).not.toHaveBeenCalled();
    expect(ghl.createContact).toHaveBeenCalledTimes(19);
    expect(body.report.updated).toBe(0);
    expect(body.report.created).toBe(19);
    expect(body.report.duplicates).toHaveLength(1);
    expect(body.report.duplicates[0].existingId).toBe('existing-cindy');
    expect(body.report.duplicates[0].matchedBy).toBe('email');
    expect(
      body.report.created + body.report.updated + body.report.failed.length + body.report.duplicates.length,
    ).toBe(20);
    // La fila duplicada no debe generar una nota/oportunidad.
    expect(ghl.createNote).toHaveBeenCalledTimes(19);
    expect(ghl.createOpportunity).toHaveBeenCalledTimes(19);
  });

  it('dedup por teléfono: el contacto existente se reporta como duplicado, el resto se crea', async () => {
    ghl.searchContacts.mockResolvedValue([
      {
        id: 'existing-tricia',
        email: '',
        phone: '647-404-4155',
        firstName: 'Tricia',
        lastName: 'Madill',
        companyName: 'Pure Magic Vacations',
      },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req('prospects.csv', false));
    const body = await res.json();
    expect(ghl.updateContact).not.toHaveBeenCalled();
    expect(ghl.createContact).toHaveBeenCalledTimes(19);
    expect(body.report.updated).toBe(0);
    expect(body.report.created).toBe(19);
    expect(body.report.duplicates).toHaveLength(1);
    expect(body.report.duplicates[0].existingId).toBe('existing-tricia');
    expect(body.report.duplicates[0].matchedBy).toBe('phone');
    expect(
      body.report.created + body.report.updated + body.report.failed.length + body.report.duplicates.length,
    ).toBe(20);
    // La fila duplicada no debe generar una nota/oportunidad.
    expect(ghl.createNote).toHaveBeenCalledTimes(19);
    expect(ghl.createOpportunity).toHaveBeenCalledTimes(19);
  });

  it('dedup por huella nombre+empresa: el contacto existente se reporta como duplicado, el resto se crea', async () => {
    ghl.searchContacts.mockResolvedValue([
      {
        id: 'existing-julio',
        email: '',
        phone: '',
        firstName: 'Julio',
        lastName: 'Calas',
        companyName: 'Anima Adventures / Nexion CA',
      },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req('prospects.csv', false));
    const body = await res.json();
    expect(ghl.updateContact).not.toHaveBeenCalled();
    expect(ghl.createContact).toHaveBeenCalledTimes(19);
    expect(body.report.updated).toBe(0);
    expect(body.report.created).toBe(19);
    expect(body.report.duplicates).toHaveLength(1);
    expect(body.report.duplicates[0].existingId).toBe('existing-julio');
    expect(body.report.duplicates[0].matchedBy).toBe('fingerprint');
    expect(
      body.report.created + body.report.updated + body.report.failed.length + body.report.duplicates.length,
    ).toBe(20);
    // La fila duplicada no debe generar una nota/oportunidad.
    expect(ghl.createNote).toHaveBeenCalledTimes(19);
    expect(ghl.createOpportunity).toHaveBeenCalledTimes(19);
  });

  it('dedup por teléfono NO sobrescribe a una persona distinta que comparte la línea', async () => {
    // Un contacto existente con el MISMO teléfono pero OTRA persona (línea de agencia
    // compartida). No debe actualizarse: se intenta crear (y GHL lo rechazará por duplicado).
    ghl.searchContacts.mockResolvedValue([
      {
        id: 'otra-persona',
        email: '',
        phone: '647-404-4155',
        firstName: 'Otra',
        lastName: 'Persona',
        companyName: 'Otra Agencia',
      },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req('prospects.csv', false));
    const body = await res.json();
    expect(ghl.updateContact).not.toHaveBeenCalled();
    expect(ghl.createContact).toHaveBeenCalledTimes(20);
    expect(body.report.updated).toBe(0);
    expect(body.report.created).toBe(20);
  });
});
