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
