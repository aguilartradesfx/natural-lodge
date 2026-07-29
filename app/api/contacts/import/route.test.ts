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
