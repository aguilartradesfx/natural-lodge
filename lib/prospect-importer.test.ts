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
import { explainGhlError, importProspects, buildDuplicateRow } from './prospect-importer';

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

describe('buildDuplicateRow', () => {
  it('mismo teléfono con formato distinto (+1 vs guiones): no lo marca como diferente', () => {
    const [m] = mapped({ phone: '647-404-4155' });
    // cleanPhone() reescribe el número entrante a E.164; GHL casi nunca lo
    // tiene guardado así, así que esto reproduce el caso real del hallazgo.
    expect(m.contact.phone).toBe('+16474044155');
    const existing = { id: 'x1', phone: '647-404-4155' } as never;
    const row = buildDuplicateRow(m, existing);
    expect(row.matchedBy).toBe('phone');
    expect(row.differingFields).not.toContain('phone');
  });

  it('teléfono genuinamente distinto: sí lo marca como diferente', () => {
    const [m] = mapped({ phone: '647-404-4155' });
    const existing = { id: 'x1', phone: '999-888-7777' } as never;
    const row = buildDuplicateRow(m, existing);
    expect(row.matchedBy).not.toBe('phone');
    expect(row.differingFields).toContain('phone');
  });
});

describe('importProspects', () => {
  it('crea cuando no existe', async () => {
    const rep = await importProspects(mapped({ email: 'ana@x.com' }));
    expect(rep.created).toBe(1);
    expect(rep.updated).toBe(0);
    expect(ghl.createContact).toHaveBeenCalledTimes(1);
  });

  it('actualiza cuando ya existe y se pide explícitamente', async () => {
    vi.mocked(ghl.searchContacts).mockResolvedValue([{ id: 'x1', email: 'a@b.com' }] as never);
    const r = await importProspects(mapped({ email: 'a@b.com' }), { onDuplicate: 'update' });
    expect(ghl.updateContact).toHaveBeenCalled();
    expect(r.updated).toBe(1);
  });

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
