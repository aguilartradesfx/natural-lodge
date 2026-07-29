import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV, GHL_PRIVATE_INTEGRATION: 'test-token', GHL_LOCATION_ID: 'LOC1' };
});
afterEach(() => {
  process.env = OLD_ENV;
  vi.restoreAllMocks();
});

function mockFetch(jsonBody: unknown) {
  const spy = vi.fn(async (_url: string, _opts: RequestInit) =>
    new Response(JSON.stringify(jsonBody), { status: 200 }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('createContact', () => {
  it('hace POST a /contacts/ con locationId y limpia campos vacíos', async () => {
    const spy = mockFetch({ contact: { id: 'c1' } });
    const { createContact } = await import('./ghl');
    const c = await createContact({ firstName: 'Julio', company: '', email: 'a@b.com' } as never);
    expect(c.id).toBe('c1');
    const [url, opts] = spy.mock.calls[0];
    expect(String(url)).toContain('/contacts/');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.locationId).toBe('LOC1');
    expect(body.firstName).toBe('Julio');
    expect('company' in body).toBe(false); // vacío se omite
  });
});

describe('searchContacts', () => {
  it('hace GET a /contacts/ con query', async () => {
    const spy = mockFetch({ contacts: [{ id: 'c1', email: 'a@b.com' }] });
    const { searchContacts } = await import('./ghl');
    const res = await searchContacts({ query: 'a@b.com' });
    expect(res[0].id).toBe('c1');
    expect(String(spy.mock.calls[0][0])).toContain('query=a%40b.com');
  });
});

describe('createOpportunity', () => {
  it('POST a /opportunities/ y devuelve id', async () => {
    const spy = mockFetch({ opportunity: { id: 'o1' } });
    const { createOpportunity } = await import('./ghl');
    const o = await createOpportunity({ pipelineId: 'p1', stageId: 's1', name: 'X', contactId: 'c1' });
    expect(o.id).toBe('o1');
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.pipelineStageId).toBe('s1');
    expect(body.status).toBe('open');
  });
});

describe('getPipelines', () => {
  it('devuelve el array de pipelines', async () => {
    mockFetch({ pipelines: [{ id: 'p1', name: 'Travel Agency Partnerships', stages: [] }] });
    const { getPipelines } = await import('./ghl');
    const ps = await getPipelines();
    expect(ps[0].name).toBe('Travel Agency Partnerships');
  });
});
