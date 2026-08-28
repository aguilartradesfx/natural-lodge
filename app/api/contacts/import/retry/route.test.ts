import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GhlContact } from '@/lib/ghl';
import type { RawProspect } from '@/lib/prospect-types';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(async () => ({ user: { email: 'x@y.com' }, error: null })),
}));

const ghl = {
  searchContacts: vi.fn(async (): Promise<GhlContact[]> => []),
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

  it('rechaza body null', async () => {
    const { POST } = await import('./route');
    const res = await POST(req(null));
    expect(res.status).toBe(400);
  });

  it('rechaza rows que no es un array', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ batchTag: 'x', rows: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('rechaza más de 500 filas', async () => {
    const { POST } = await import('./route');
    const rows = Array.from({ length: 501 }, () => raw({ email: 'a@b.com' }));
    const res = await POST(req({ batchTag: 'x', rows }));
    expect(res.status).toBe(400);
  });

  it('rechaza una fila malformada', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ batchTag: 'x', rows: [{ firstName: 'X' }] } as never));
    expect(res.status).toBe(400);
  });

  it('mode "forceUpdate" actualiza el contacto duplicado y no lo reporta', async () => {
    ghl.searchContacts.mockResolvedValue([
      {
        id: 'existing-ana',
        email: 'ana@x.com',
        phone: '',
        firstName: 'Ana',
        lastName: 'Pérez',
        companyName: 'Viajes X',
      },
    ]);
    const { POST } = await import('./route');
    const res = await POST(
      req({ batchTag: 'x', rows: [raw({ email: 'ana@x.com' })], mode: 'forceUpdate' }),
    );
    const body = await res.json();
    expect(ghl.updateContact).toHaveBeenCalledTimes(1);
    expect(body.report.duplicates).toHaveLength(0);
  });

  it('sin mode NO actualiza el contacto duplicado y lo reporta (default seguro)', async () => {
    ghl.searchContacts.mockResolvedValue([
      {
        id: 'existing-ana',
        email: 'ana@x.com',
        phone: '',
        firstName: 'Ana',
        lastName: 'Pérez',
        companyName: 'Viajes X',
      },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req({ batchTag: 'x', rows: [raw({ email: 'ana@x.com' })] }));
    const body = await res.json();
    expect(ghl.updateContact).not.toHaveBeenCalled();
    expect(body.report.duplicates).toHaveLength(1);
  });

  it('mode "normal" tampoco actualiza el contacto duplicado y lo reporta', async () => {
    ghl.searchContacts.mockResolvedValue([
      {
        id: 'existing-ana',
        email: 'ana@x.com',
        phone: '',
        firstName: 'Ana',
        lastName: 'Pérez',
        companyName: 'Viajes X',
      },
    ]);
    const { POST } = await import('./route');
    const res = await POST(
      req({ batchTag: 'x', rows: [raw({ email: 'ana@x.com' })], mode: 'normal' }),
    );
    const body = await res.json();
    expect(ghl.updateContact).not.toHaveBeenCalled();
    expect(body.report.duplicates).toHaveLength(1);
  });
});
