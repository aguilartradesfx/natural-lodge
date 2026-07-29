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

  it('dedup por email: contacto existente se actualiza, el resto se crea', async () => {
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
    expect(ghl.updateContact).toHaveBeenCalledTimes(1);
    expect(ghl.updateContact).toHaveBeenCalledWith('existing-cindy', expect.anything());
    expect(ghl.createContact).toHaveBeenCalledTimes(19);
    expect(body.report.updated).toBe(1);
    expect(body.report.created).toBe(19);
    expect(body.report.created + body.report.updated + body.report.failed.length).toBe(20);
  });

  it('dedup por teléfono: contacto existente se actualiza, el resto se crea', async () => {
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
    expect(ghl.updateContact).toHaveBeenCalledTimes(1);
    expect(ghl.updateContact).toHaveBeenCalledWith('existing-tricia', expect.anything());
    expect(ghl.createContact).toHaveBeenCalledTimes(19);
    expect(body.report.updated).toBe(1);
    expect(body.report.created).toBe(19);
    expect(body.report.created + body.report.updated + body.report.failed.length).toBe(20);
  });

  it('dedup por huella nombre+empresa: contacto existente se actualiza, el resto se crea', async () => {
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
    expect(ghl.updateContact).toHaveBeenCalledTimes(1);
    expect(ghl.updateContact).toHaveBeenCalledWith('existing-julio', expect.anything());
    expect(ghl.createContact).toHaveBeenCalledTimes(19);
    expect(body.report.updated).toBe(1);
    expect(body.report.created).toBe(19);
    expect(body.report.created + body.report.updated + body.report.failed.length).toBe(20);
  });
});
