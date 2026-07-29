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
  // codepage: 65001 (UTF-8) evita mojibake en CSV con acentos (ej. "Caño Negro" -> "CaÃ±o Negro").
  // SheetJS no detecta UTF-8 automáticamente al leer CSV como buffer sin esta opción.
  const wb = XLSX.read(data, { type: 'buffer', codepage: 65001 });

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
