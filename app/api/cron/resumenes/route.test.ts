import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { scanAndSummarize, logWorkflowError } = vi.hoisted(() => ({
  scanAndSummarize: vi.fn(),
  logWorkflowError: vi.fn(async () => {}),
}));

vi.mock('@/lib/review-scan', () => ({ scanAndSummarize }));
vi.mock('@/lib/error-log', () => ({ logWorkflowError }));

import { GET } from './route';

const RESULTADO = { candidatos: 3, creados: 3, fallidos: 0 };

function req(auth?: string): Request {
  return new Request('http://t/api/cron/resumenes', {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  scanAndSummarize.mockReset();
  scanAndSummarize.mockResolvedValue(RESULTADO);
  logWorkflowError.mockClear();
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('GET /api/cron/resumenes', () => {
  it('corre el barrido y devuelve el conteo', async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(body).toEqual({ ok: true, ...RESULTADO });
    expect(scanAndSummarize).toHaveBeenCalledTimes(1);
  });

  it('rechaza sin el Bearer correcto cuando hay CRON_SECRET', async () => {
    process.env.CRON_SECRET = 's3cr3t';

    const res = await GET(req('Bearer otro'));

    expect(res.status).toBe(401);
    expect(scanAndSummarize).not.toHaveBeenCalled();
  });

  it('acepta con el Bearer correcto', async () => {
    process.env.CRON_SECRET = 's3cr3t';

    const res = await GET(req('Bearer s3cr3t'));

    expect(res.status).toBe(200);
    expect(scanAndSummarize).toHaveBeenCalledTimes(1);
  });

  it('registra y devuelve 500 si el barrido explota', async () => {
    scanAndSummarize.mockRejectedValue(new Error('boom'));

    const res = await GET(req());

    expect(res.status).toBe(500);
    expect(logWorkflowError).toHaveBeenCalledTimes(1);
  });
});
