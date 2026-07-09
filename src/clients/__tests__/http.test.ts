import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHttp, UpstreamError } from '../http.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makeHttp', () => {
  it('adds bearer auth and normalizes base paths', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const http = makeHttp({ baseUrl: 'http://svc.test/', token: 'token-1', service: 'svc' });
    await expect(http.get('/api/health')).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith('http://svc.test/api/health', {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer token-1',
      },
      body: undefined,
    });
  });

  it('throws UpstreamError on non-2xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('broken', { status: 500 }));

    const http = makeHttp({ baseUrl: 'http://svc.test', token: null, service: 'svc' });
    await expect(http.get('/api/health')).rejects.toBeInstanceOf(UpstreamError);
  });
});
