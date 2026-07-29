import type { RawProspect } from './prospect-types';

export type MappedProspect = {
  raw: RawProspect;
  contact: {
    firstName: string; lastName: string; name: string; companyName: string;
    email: string; phone: string; website: string;
    city: string; state: string; country: string; source: string;
  };
  tags: string[];
  note: string;
  customFields: Array<{ name: string; value: string }>;
  opportunityName: string;
  fingerprint: string;
  hasContactChannel: boolean;
};

export function parseTags(tagsRaw: string): string[] {
  return tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function deriveBatchTag(sourceOrFilename: string): string {
  const slug = slugify(sourceOrFilename.replace(/\.(csv|xlsx)$/i, ''));
  return `Import-${slug}`;
}

export function contactFingerprint(firstName: string, lastName: string, company: string): string {
  return slugify(`${firstName} ${lastName} ${company}`);
}

/** Deriva tags cuando la fuente no trae una columna de Tags (ej. hoja XLSX). */
export function synthesizeTags(raw: RawProspect): string[] {
  const tags: string[] = [];

  if (/operator|supplier/i.test(raw.leadType)) {
    tags.push('B2B-Operator', 'Supplier-Prospect');
  } else if (raw.leadType) {
    tags.push('B2B-Agent', 'Travel-Advisor');
  }

  if (raw.priority) tags.push(`Priority-${raw.priority.trim().toUpperCase()}`);

  if (raw.marketReach.trim().toLowerCase() === 'high') tags.push('High-Market-Reach');

  if (raw.country) tags.push(raw.country.trim());

  return tags;
}

export function buildNote(raw: RawProspect): string {
  const lines: string[] = [];
  const head = [
    raw.priority && `Prioridad: ${raw.priority}`,
    raw.leadScore && `Score: ${raw.leadScore}`,
    raw.leadType && `Tipo: ${raw.leadType}`,
  ].filter(Boolean).join('  ·  ');
  if (head) lines.push(head);
  if (raw.pitchAngle) lines.push(`Pitch: ${raw.pitchAngle}`);
  if (raw.firstAction) lines.push(`Acción sugerida: ${raw.firstAction}`);
  if (raw.contactMethod) lines.push(`Método: ${raw.contactMethod}`);
  const social = [
    raw.instagram && `IG ${raw.instagram}`,
    raw.facebook && `FB ${raw.facebook}`,
    raw.linkedin && `LinkedIn ${raw.linkedin}`,
  ].filter(Boolean).join(' · ');
  if (social) lines.push(`Redes: ${social}`);
  if (raw.natureFit) lines.push(`Nature Fit: ${raw.natureFit}`);
  if (raw.evidence) lines.push(`Evidencia: ${raw.evidence}`);
  if (raw.confidence) lines.push(`Confianza: ${raw.confidence}`);
  if (raw.notes) lines.push(`Notas: ${raw.notes}`);
  return lines.join('\n');
}

const CUSTOM_FIELD_MAP: Array<{ name: string; get: (r: RawProspect) => string }> = [
  { name: 'Lead Score', get: (r) => r.leadScore },
  { name: 'Priority', get: (r) => r.priority },
  { name: 'Lead Type', get: (r) => r.leadType },
  { name: 'Pitch Angle', get: (r) => r.pitchAngle },
  { name: 'Market Reach', get: (r) => r.marketReach },
  { name: 'Activity Level', get: (r) => r.activityLevel },
  { name: 'Content Fit', get: (r) => r.contentFit },
  { name: 'Best Contact URL', get: (r) => r.bestContactUrl },
  { name: 'Lead ID', get: (r) => r.leadId },
];

export function mapProspect(raw: RawProspect, batchTag: string): MappedProspect {
  let tags = parseTags(raw.tagsRaw);
  if (tags.length === 0) tags = synthesizeTags(raw);
  if (batchTag && !tags.includes(batchTag)) tags.push(batchTag);

  const hasContactChannel = Boolean(raw.email || raw.phone);
  if (!hasContactChannel) tags.push('Contacto-Pendiente');

  const customFields = CUSTOM_FIELD_MAP
    .map((f) => ({ name: f.name, value: f.get(raw) }))
    .filter((f) => f.value !== '');

  const name = [raw.firstName, raw.lastName].filter(Boolean).join(' ').trim();

  return {
    raw,
    contact: {
      firstName: raw.firstName,
      lastName: raw.lastName,
      name: name || raw.company,
      companyName: raw.company,
      email: raw.email,
      phone: raw.phone,
      website: raw.website,
      city: raw.city,
      state: raw.state,
      country: raw.country,
      source: raw.source,
    },
    tags,
    note: buildNote(raw),
    customFields,
    opportunityName: raw.company || name || 'Prospecto',
    fingerprint: contactFingerprint(raw.firstName, raw.lastName, raw.company),
    hasContactChannel,
  };
}
