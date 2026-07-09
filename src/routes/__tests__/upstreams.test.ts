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
});
