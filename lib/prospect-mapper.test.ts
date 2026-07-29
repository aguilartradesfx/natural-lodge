import { describe, it, expect } from 'vitest';
import type { RawProspect } from './prospect-types';
import {
  parseTags, deriveBatchTag, contactFingerprint, mapProspect, synthesizeTags,
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

describe('synthesizeTags', () => {
  it('para una fila de Advisor deriva tags de agente, prioridad, alcance y país', () => {
    const raw = makeRaw({ leadType: 'Advisor', priority: 'A', marketReach: 'High', country: 'Canada' });
    expect(synthesizeTags(raw)).toEqual([
      'B2B-Agent', 'Travel-Advisor', 'Priority-A', 'High-Market-Reach', 'Canada',
    ]);
  });
  it('para una fila de Operator/Supplier deriva tags de operador', () => {
    const raw = makeRaw({ leadType: 'Operator / Supplier Prospect' });
    const tags = synthesizeTags(raw);
    expect(tags).toContain('B2B-Operator');
    expect(tags).toContain('Supplier-Prospect');
  });
});

describe('mapProspect con tagsRaw vacío (simula fila de XLSX)', () => {
  it('usa tags sintetizados', () => {
    const m = mapProspect(makeRaw({ tagsRaw: '' }), 'Import-lote');
    expect(m.tags).toContain('Priority-A');
    expect(m.tags).toContain('Import-lote');
  });
});

describe('mapProspect con tagsRaw no vacío', () => {
  it('usa los tags parseados y NO sintetiza', () => {
    const m = mapProspect(makeRaw({}), 'Import-lote');
    expect(m.tags).toEqual(expect.arrayContaining(['B2B-Agent', 'Priority-A', 'Costa-Rica', 'Import-lote']));
    expect(m.tags).not.toContain('Travel-Advisor');
  });
});
