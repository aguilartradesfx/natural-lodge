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
    // Si el `continue` se moviera debajo del armado de etiquetas, un cliente que
    // ya existe empezaría a recibirlas sin que ninguna otra prueba se queje.
    expect(ghl.addContactTags).not.toHaveBeenCalled();
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

  it('fila sin correo NI teléfono con startSequence → Contacto-Pendiente y NO la de secuencia', async () => {
    await importProspects(mapped({ email: '', phone: '' }), { startSequence: true });
    expect(tagsUsados()).toContain('Contacto-Pendiente');
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

  // El operador puede corregir el correo en la bandeja y luego pulsar "Importar de
  // todos modos": `findExisting` ya no encuentra nada y la fila se crea. Se
  // etiqueta por intención, así que igual cae en cuarentena y nunca en la secuencia.
  it('onDuplicate update sobre una fila que YA NO coincide → igual va a cuarentena', async () => {
    vi.mocked(ghl.searchContacts).mockResolvedValue([]);
    const r = await importProspects(mapped({ email: 'corregido@x.com' }), {
      startSequence: true,
      onDuplicate: 'update',
    });
    expect(r.created).toBe(1);
    expect(ghl.createContact).toHaveBeenCalledTimes(1);
    expect(tagsUsados()).toContain('duplicado-revisar');
    expect(tagsUsados()).not.toContain('secuencia-prospeccion');
  });
});

// El archivo del cliente trae una columna "Tags" con 9 etiquetas por fila, y el
// `batchTag` del cuerpo de /retry tampoco está validado: si `secuencia-prospeccion`
// se pudiera colar por ahí, las tres compuertas del diseño se saltarían de una.
describe('etiquetas reservadas inyectadas desde el archivo', () => {
  const tagsUsados = () => vi.mocked(ghl.addContactTags).mock.calls[0][1];

  it('fila nueva con correo y la casilla DESMARCADA → se ignora la etiqueta del archivo', async () => {
    await importProspects(mapped({ email: 'a@b.com', tagsRaw: 'secuencia-prospeccion' }));
    expect(tagsUsados()).not.toContain('secuencia-prospeccion');
  });

  it('fila SIN correo con startSequence → se ignora la etiqueta del archivo', async () => {
    await importProspects(
      mapped({ email: '', phone: '+50688881111', tagsRaw: 'secuencia-prospeccion' }),
      { startSequence: true },
    );
    expect(tagsUsados()).not.toContain('secuencia-prospeccion');
  });

  it('contacto EXISTENTE forzado con update → solo duplicado-revisar, nunca la de secuencia', async () => {
    vi.mocked(ghl.searchContacts).mockResolvedValue([{ id: 'x1', email: 'a@b.com' }] as never);
    await importProspects(mapped({ email: 'a@b.com', tagsRaw: 'secuencia-prospeccion' }), {
      onDuplicate: 'update',
    });
    expect(tagsUsados()).toContain('duplicado-revisar');
    expect(tagsUsados()).not.toContain('secuencia-prospeccion');
  });

  it('el filtro no distingue mayúsculas ni espacios, y deja pasar las etiquetas normales', async () => {
    await importProspects(
      mapped({ email: 'a@b.com', tagsRaw: '  Secuencia-Prospeccion , DUPLICADO-REVISAR , Toronto ' }),
      { startSequence: true },
    );
    const t = tagsUsados();
    expect(t.filter((x) => x.toLowerCase() === 'secuencia-prospeccion')).toHaveLength(1);
    // La única que queda es la que puso el importador, no la del archivo.
    expect(t).toContain('secuencia-prospeccion');
    expect(t).not.toContain('Secuencia-Prospeccion');
    expect(t).not.toContain('duplicado-revisar');
    expect(t).not.toContain('DUPLICADO-REVISAR');
    expect(t).toContain('Toronto');
    expect(t).toContain('Import-x');
  });
});
