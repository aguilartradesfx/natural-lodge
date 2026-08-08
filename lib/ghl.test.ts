import { describe, it, expect } from 'vitest';
import { ghlTimestamp } from './ghl';

describe('ghlTimestamp', () => {
  it('usa offset numérico y no la Z de toISOString', () => {
    // GHL rechaza `2026-08-08T22:11:44.118Z` con un 422 pidiendo "a date and
    // time with timezone offset", aunque sea ISO 8601 válido. Por eso el
    // workflow de escalamiento fallaba en silencio: el bot prometía contacto
    // y nadie recibía la notificación.
    const t = ghlTimestamp(new Date('2026-08-08T22:11:44.118Z'));
    expect(t).toBe('2026-08-08T22:11:44+00:00');
    expect(t).not.toContain('Z');
  });

  it('no lleva milisegundos', () => {
    // El ejemplo del error de GHL no los incluye; no arriesgamos.
    expect(ghlTimestamp(new Date('2026-01-02T03:04:05.999Z'))).not.toMatch(/\.\d/);
  });

  it('coincide con el formato del ejemplo que da GHL', () => {
    expect(ghlTimestamp(new Date('2026-08-08T22:11:44.118Z'))).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
  });
});
