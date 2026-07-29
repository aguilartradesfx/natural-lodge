import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BatchMetrics } from './prospect-validator';

const create = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create } },
  ANTHROPIC_MODEL: 'test-model',
}));

const metrics: BatchMetrics = {
  total: 20, withChannel: 5, withoutChannel: 15, withEmail: 2, withPhone: 4, invalidEmails: 1,
};

// NOTE: block body (not an implicit-return arrow) on purpose. `mockReset()`
// returns the mock itself; an implicit-return `beforeEach(() => create.mockReset())`
// hands that function back to Vitest, which treats a value returned from a
// setup hook as a teardown callback and invokes it again after each test —
// re-triggering the (by-then-rejecting) mock unawaited and failing the test
// with its rejection. See task-6-report.md for the isolated repro.
beforeEach(() => { create.mockReset(); });

describe('summarizeBatch', () => {
  it('usa el texto de Claude cuando responde', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'Resumen de Claude.' }] });
    const { summarizeBatch } = await import('./prospect-summary');
    const s = await summarizeBatch({ metrics, sampleWarnings: [] });
    expect(s.text).toBe('Resumen de Claude.');
    expect(s.alerts).toContain('1 correo(s) con formato inválido');
    expect(s.alerts).toContain('15 sin correo ni teléfono');
  });

  it('cae al resumen calculado si Claude falla', async () => {
    create.mockRejectedValue(new Error('sin API key'));
    const { summarizeBatch } = await import('./prospect-summary');
    const s = await summarizeBatch({ metrics, sampleWarnings: [] });
    expect(s.text).toContain('20 contactos');
    expect(s.text).toContain('15 sin datos de contacto');
  });
});
