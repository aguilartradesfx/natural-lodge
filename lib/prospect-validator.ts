import type { RawProspect } from './prospect-types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RowValidation = { rowNumber: number; warnings: string[] };

export type BatchMetrics = {
  total: number;
  withChannel: number;
  withoutChannel: number;
  withEmail: number;
  withPhone: number;
  invalidEmails: number;
};

export function validateProspects(rows: RawProspect[]): {
  validations: RowValidation[];
  metrics: BatchMetrics;
} {
  const validations: RowValidation[] = [];
  let withChannel = 0;
  let withEmail = 0;
  let withPhone = 0;
  let invalidEmails = 0;

  for (const r of rows) {
    const warnings: string[] = [];
    const hasEmail = Boolean(r.email);
    const hasPhone = Boolean(r.phone);
    const emailValid = hasEmail && EMAIL_RE.test(r.email);

    if (hasEmail) {
      withEmail++;
      if (!emailValid) {
        warnings.push('Correo con formato inválido');
        invalidEmails++;
      }
    }
    if (hasPhone) withPhone++;

    if (!hasEmail && !hasPhone) {
      warnings.push('Sin correo ni teléfono (quedará marcado como pendiente)');
    } else {
      withChannel++;
    }

    if (!r.firstName && !r.lastName && !r.company) {
      warnings.push('Sin nombre ni empresa');
    }

    validations.push({ rowNumber: r.rowNumber, warnings });
  }

  return {
    validations,
    metrics: {
      total: rows.length,
      withChannel,
      withoutChannel: rows.length - withChannel,
      withEmail,
      withPhone,
      invalidEmails,
    },
  };
}
