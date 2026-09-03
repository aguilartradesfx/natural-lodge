import { describe, it, expect } from 'vitest';
import type { RawProspect } from './prospect-types';
import {
  parseTags, deriveBatchTag, contactFingerprint, mapProspect, synthesizeTags, cleanPhone,
  normalizeCountry,
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

describe('cleanPhone', () => {
  it('toma el primer número cuando hay dos separados por " / "', () => {
    expect(cleanPhone('604-669-6607 / 1-877-523-7823')).toBe('+16046696607');
  });
  it('descarta extensiones tipo "EXT. 2995"', () => {
    expect(cleanPhone('604-258-7395 EXT. 2995')).toBe('+16042587395');
  });
  it('descarta "ext 533 / WhatsApp ..."', () => {
    expect(cleanPhone('604-669-6607 ext 533 / WhatsApp 604-220-6238')).toBe('+16046696607');
  });
  it('conserva el + y los dígitos de un número internacional', () => {
    expect(cleanPhone('+1 778-873-1165')).toBe('+17788731165');
  });
  it('normaliza un número nacional de 11 dígitos con 1', () => {
    expect(cleanPhone('1-888-747-2111')).toBe('+18887472111');
  });
  it('devuelve vacío si no hay dígitos suficientes', () => {
    expect(cleanPhone('')).toBe('');
    expect(cleanPhone('ver web')).toBe('');
  });
  it('mapProspect deja el teléfono limpio en el contacto', () => {
    const m = mapProspect(makeRaw({ phone: '604-669-6607 / 1-877-523-7823' }), 'Import-lote');
    expect(m.contact.phone).toBe('+16046696607');
  });
});

// Regresión del 500 del 2026-09-02: el archivo de NY traía "USA" en las 31 filas.
// GHL acepta ISO-2 ("US") y el nombre completo ("United States"), pero rechaza
// "USA" con 422 → ninguna fila entraba. Verificado contra la API real.
describe('normalizeCountry', () => {
  it('USA → US (el valor que GHL rechaza)', () => {
    expect(normalizeCountry('USA')).toBe('US');
  });
  it('acepta variantes con puntos y espacios', () => {
    expect(normalizeCountry(' u.s.a. ')).toBe('US');
    expect(normalizeCountry('U.S.')).toBe('US');
  });
  it('UK → GB, que es el código ISO real', () => {
    expect(normalizeCountry('UK')).toBe('GB');
  });
  it('deja pasar lo que GHL sí acepta', () => {
    expect(normalizeCountry('Canada')).toBe('Canada');
    expect(normalizeCountry('US')).toBe('US');
    expect(normalizeCountry('CR')).toBe('CR');
    expect(normalizeCountry('Costa Rica')).toBe('Costa Rica');
  });
  it('vacío se queda vacío', () => {
    expect(normalizeCountry('')).toBe('');
  });
});

describe('mapProspect', () => {
  it('normaliza el país antes de mandarlo a GHL', () => {
    expect(mapProspect(makeRaw({ country: 'USA' }), 'Import-x').contact.country).toBe('US');
  });

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
