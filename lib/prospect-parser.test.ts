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
