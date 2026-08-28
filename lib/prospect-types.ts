/** Modelo interno único: el resto del sistema no sabe si vino de CSV o XLSX. */
export type RawProspect = {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  country: string;
  source: string;
  tagsRaw: string;
  pipeline: string;
  stage: string;
  leadScore: string;
  priority: string;
  leadType: string;
  pitchAngle: string;
  contactMethod: string;
  bestContactUrl: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  marketReach: string;
  activityLevel: string;
  contentFit: string;
  notes: string;
  firstAction: string;
  natureFit: string;
  evidence: string;
  confidence: string;
  leadId: string;
  /** Fila de datos 1-based (para el reporte). */
  rowNumber: number;
};

/**
 * Fila que ya existe en GHL y espera decisión humana en la bandeja de revisión.
 * Vive acá —y no en el importador— para que el cliente pueda importar el tipo
 * sin arrastrar `server-only`. `import type` se borra al compilar, pero mantener
 * el tipo en un módulo neutral evita que un import de valor lo rompa después.
 */
export type DuplicateRow = {
  rowNumber: number;
  name: string;
  company: string;
  matchedBy: 'email' | 'phone' | 'fingerprint';
  existingId: string;
  incoming: Record<string, string>;   // lo que trae el archivo
  existing: Record<string, string>;   // lo que hay en GHL
  differingFields: string[];          // solo los que no coinciden
  raw: RawProspect;
};
