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

// El workbook del equipo NO tiene columnas fijas entre lotes (p.ej. Toronto usa
// "Advisor"/"Agency"/"Score"/"Email"/"City"; Vancouver usa "Advisor Name"/
// "Agency Name"/"Lead Score"/"Direct Email"/"City / Metro"). Por eso la hoja
// "Manual Leads" se resuelve por ALIAS de encabezado normalizado, no por nombre
// exacto. Cada campo lista los encabezados aceptados (ya normalizados) en orden
// de preferencia; se toma la primera columna presente.
const XLSX_FIELD_ALIASES: Array<[keyof RawProspect, string[]]> = [
  ['leadId', ['lead id']],
  ['priority', ['priority']],
  ['leadScore', ['score', 'lead score']],
  ['leadType', ['lead type']],
  ['company', ['agency', 'agency name', 'company', 'company name']],
  ['city', ['city', 'city / metro', 'city/metro']],
  ['state', ['province', 'state', 'state/province', 'state / province']],
  ['country', ['country']],
  ['phone', ['phone']],
  ['website', ['website']],
  ['contactMethod', ['contact method', 'best contact method']],
  ['bestContactUrl', ['best contact url', 'contact url']],
  ['pitchAngle', ['pitch angle']],
  ['instagram', ['instagram']],
  ['facebook', ['facebook']],
  ['linkedin', ['linkedin']],
  ['marketReach', ['market reach']],
  ['activityLevel', ['activity level']],
  ['contentFit', ['content fit']],
  ['notes', ['notes', 'personalization notes', 'notes / outcome']],
  ['firstAction', ['first action', 'best first action']],
  ['natureFit', ['nature fit']],
  ['evidence', ['costa rica evidence']],
  ['confidence', ['confidence']],
];
// Columna de nombre completo (se divide en firstName/lastName).
const XLSX_NAME_ALIASES = ['advisor', 'advisor name'];
// Solo el correo directo/personal; NO usamos el correo de agencia como personal.
const XLSX_EMAIL_ALIASES = ['email', 'direct email'];

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

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

  // Índice de columnas por encabezado normalizado (para la resolución por alias del XLSX).
  const colByNorm = new Map<string, number>();
  header.forEach((h, idx) => {
    const n = normHeader(h);
    if (n && !colByNorm.has(n)) colByNorm.set(n, idx);
  });
  const findCol = (aliases: string[]): number => {
    for (const a of aliases) {
      const idx = colByNorm.get(a);
      if (idx !== undefined) return idx;
    }
    return -1;
  };

  // XLSX: columnas resueltas por alias (soporta distintos layouts de workbook).
  const xlsxFieldCols: Array<[keyof RawProspect, number]> = isCsv
    ? []
    : XLSX_FIELD_ALIASES.map(([f, al]) => [f, findCol(al)] as [keyof RawProspect, number]).filter(
        ([, idx]) => idx >= 0,
      );
  const nameCol = isCsv ? -1 : findCol(XLSX_NAME_ALIASES);
  const emailCol = isCsv ? -1 : findCol(XLSX_EMAIL_ALIASES);

  const prospects: RawProspect[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = (rows[i] as unknown[]).map((c) => String(c ?? '').trim());
    if (cells.every((c) => c === '')) continue;

    const p = emptyProspect(prospects.length + 1);

    if (isCsv) {
      // El CSV br_alto tiene columnas fijas → mapeo exacto por nombre.
      for (let c = 0; c < header.length; c++) {
        const field = CSV_MAP[header[c]];
        if (field) (p[field] as string) = cells[c] ?? '';
      }
      if (p.notes.includes(' | ')) {
        const [note, action] = p.notes.split(' | ');
        p.notes = (note ?? '').trim();
        p.firstAction = (action ?? '').trim();
      }
    } else {
      for (const [field, col] of xlsxFieldCols) {
        (p[field] as string) = cells[col] ?? '';
      }
      if (nameCol >= 0) {
        const parts = (cells[nameCol] ?? '').trim().split(/\s+/).filter(Boolean);
        p.firstName = parts[0] ?? '';
        p.lastName = parts.slice(1).join(' ');
      }
      if (emailCol >= 0) p.email = cells[emailCol] ?? '';
    }

    if (!p.source) p.source = DEFAULT_SOURCE;
    if (!p.pipeline) p.pipeline = DEFAULT_PIPELINE;
    if (!p.stage) p.stage = DEFAULT_STAGE;

    prospects.push(p);
  }

  return { format: isCsv ? 'csv' : 'xlsx', prospects };
}
