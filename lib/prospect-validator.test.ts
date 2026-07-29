import { describe, it, expect } from 'vitest';
import type { RawProspect } from './prospect-types';
import { validateProspects } from './prospect-validator';

function raw(over: Partial<RawProspect>, rowNumber: number): RawProspect {
  return {
    firstName: 'A', lastName: 'B', company: 'C', email: '', phone: '', website: '', city: '',
    state: '', country: '', source: '', tagsRaw: '', pipeline: '', stage: '', leadScore: '',
    priority: '', leadType: '', pitchAngle: '', contactMethod: '', bestContactUrl: '',
    instagram: '', facebook: '', linkedin: '', marketReach: '', activityLevel: '', contentFit: '',
    notes: '', firstAction: '', natureFit: '', evidence: '', confidence: '', leadId: '', rowNumber,
    ...over,
  };
}

describe('validateProspects', () => {
  const rows = [
    raw({ email: 'good@x.com' }, 1),
    raw({ email: 'bad-email', phone: '' }, 2),
    raw({ email: '', phone: '' }, 3),
    raw({ phone: '555-1234' }, 4),
  ];
  const { validations, metrics } = validateProspects(rows);

  it('cuenta totales y canales', () => {
    expect(metrics.total).toBe(4);
    expect(metrics.withEmail).toBe(1);
    expect(metrics.withPhone).toBe(1);
    expect(metrics.invalidEmails).toBe(1);
    expect(metrics.withoutChannel).toBe(1);
  });

  it('marca correo inválido', () => {
    expect(validations[1].warnings.join()).toContain('inválido');
  });

  it('marca fila sin canal de contacto', () => {
    expect(validations[2].warnings.join()).toContain('Sin correo ni teléfono');
  });
});
