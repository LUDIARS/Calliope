import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.ts';
import type { CalliopeConfig } from '../../config.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function config(overrides: Partial<CalliopeConfig> = {}): CalliopeConfig {
  return {
    port: 0,
    dbPath: ':memory:',
    agentLanes: 3,
    serviceToken: null,
    llmEstimation: false,
    actio: { baseUrl: null, token: null },
    schedula: { baseUrl: null, token: null },
    memoria: { baseUrl: null, token: null },
    concordiaBaseUrl: null,
    nuntiusBaseUrl: null,
    claudeBin: 'claude',
    ...overrides,
  };
}

describe('upstream routes', () => {
  it('returns 503 when an upstream is not configured', async () => {
    const app = createApp(config());
    const res = await app.request('/api/upstreams/actio/tasks');

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'actio_unconfigured' });
  });

  it('maps upstream non-2xx responses to 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 500 }));
    const app = createApp(config({ actio: { baseUrl: 'http://actio.test', token: null } }));

    const res = await app.request('/api/upstreams/actio/tasks');

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: 'upstream_error',
      service: 'actio',
      path: '/api/tasks',
      status: 500,
    });
  });

  it('returns 503 projecthub_unconfigured when PROJECTHUB baseUrl is unset', async () => {
    const app = createApp(config());
    const res = await app.request('/api/upstreams/projecthub/projects');

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'projecthub_unconfigured' });
  });

  it('returns 503 projecthub_unconfigured when PROJECTHUB service token is unset (baseUrl alone is not enough)', async () => {
    const app = createApp(config({ projecthub: { baseUrl: 'http://projecthub.test', token: null, serviceToken: null } }));
    const res = await app.request('/api/upstreams/projecthub/projects');

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'projecthub_unconfigured' });
  });

  it('reaches the real PROJECTHUB external projects path once configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ projects: [] }));
    const app = createApp(config({
      projecthub: { baseUrl: 'http://projecthub.test', token: null, serviceToken: 'svc-token' },
    }));

    const res = await app.request('/api/upstreams/projecthub/projects');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://projecthub.test/api/x/projects/external/projects');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ 'x-projecthub-service-token': 'svc-token' }),
    });
  });
});
