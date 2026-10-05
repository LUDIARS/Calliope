import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { apiAuth, CALLIOPE_API_SCOPE } from '../../routes/auth.ts';
import { makeServiceAuthHeader } from '../../clients/service-auth-header.ts';
import type { CernerePublicKeySource } from '../cernere-public-keys.ts';
import { makeCernerePublicKeySource } from '../cernere-public-keys.ts';
import { pae, V4_PUBLIC_HEADER, verifyV4Public } from '../paseto-v4.ts';
import { makeServiceTokenClient, ServiceTokenUnavailable } from '../service-token-client.ts';
import { makeServiceTokenVerifier, ServiceTokenRejected } from '../service-token-verifier.ts';

const NOW = Date.parse('2026-10-05T12:00:00Z');

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { publicKey, privateKey, rawBase64: Buffer.from(raw).toString('base64') };
}

function signV4(payload: Record<string, unknown>, privateKey: KeyObject, footer = ''): string {
  const message = Buffer.from(JSON.stringify(payload));
  const footerBuf = Buffer.from(footer);
  const signature = sign(null, pae([Buffer.from(V4_PUBLIC_HEADER), message, footerBuf, Buffer.alloc(0)]), privateKey);
  const body = Buffer.concat([message, signature]).toString('base64url');
  return `${V4_PUBLIC_HEADER}${body}${footer ? `.${footerBuf.toString('base64url')}` : ''}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'service',
    sub: 'glab',
    aud: 'calliope',
    scope: [CALLIOPE_API_SCOPE],
    iat: new Date(NOW - 1000).toISOString(),
    exp: new Date(NOW + 15 * 60 * 1000).toISOString(),
    jti: 'j1',
    ...overrides,
  };
}

function staticKeys(...keys: KeyObject[]): CernerePublicKeySource {
  return { keys: async () => keys, refresh: async () => keys };
}

describe('verifyV4Public', () => {
  it('accepts a token signed by any of the given keys, with or without footer', () => {
    const a = keyPair();
    const b = keyPair();
    expect(verifyV4Public(signV4({ x: 1 }, b.privateKey), [a.publicKey, b.publicKey])).toEqual({ x: 1 });
    expect(verifyV4Public(signV4({ x: 2 }, a.privateKey, '{"kid":"k1"}'), [a.publicKey])).toEqual({ x: 2 });
  });

  it('rejects a tampered or foreign token', () => {
    const a = keyPair();
    const b = keyPair();
    expect(() => verifyV4Public(signV4({ x: 1 }, b.privateKey), [a.publicKey])).toThrow('signature mismatch');
    expect(() => verifyV4Public('v4.local.abc', [a.publicKey])).toThrow();
    expect(() => verifyV4Public(`${V4_PUBLIC_HEADER}AAAA`, [a.publicKey])).toThrow('malformed token');
  });
});

describe('makeServiceTokenVerifier', () => {
  const kp = keyPair();
  const verifier = makeServiceTokenVerifier({ keySource: staticKeys(kp.publicKey), audience: 'calliope', now: () => NOW });

  it('accepts kind=service, unexpired, matching aud and required scope', async () => {
    await expect(verifier(signV4(claims(), kp.privateKey), CALLIOPE_API_SCOPE)).resolves.toMatchObject({ sub: 'glab' });
  });

  it.each([
    ['user token', { kind: 'user_for_project' }],
    ['other audience', { aud: 'glab' }],
    ['expired', { exp: new Date(NOW - 1).toISOString() }],
    ['malformed scope', { scope: 'calliope-api:access' }],
  ])('rejects %s as invalid', async (_label, override) => {
    await expect(verifier(signV4(claims(override), kp.privateKey), CALLIOPE_API_SCOPE))
      .rejects.toMatchObject({ reason: 'invalid' });
  });

  it('rejects a missing scope as forbidden', async () => {
    await expect(verifier(signV4(claims({ scope: ['other:read'] }), kp.privateKey), CALLIOPE_API_SCOPE))
      .rejects.toBeInstanceOf(ServiceTokenRejected);
    await expect(verifier(signV4(claims({ scope: ['other:read'] }), kp.privateKey), CALLIOPE_API_SCOPE))
      .rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('refreshes keys once after a signature mismatch (key rotation)', async () => {
    const rotated = keyPair();
    const refresh = vi.fn(async () => [rotated.publicKey]);
    const rotating = makeServiceTokenVerifier({
      keySource: { keys: async () => [kp.publicKey], refresh },
      audience: 'calliope',
      now: () => NOW,
    });
    await expect(rotating(signV4(claims(), rotated.privateKey), CALLIOPE_API_SCOPE)).resolves.toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('makeCernerePublicKeySource', () => {
  it('fetches the well-known keys, skips unusable entries and caches until ttl', async () => {
    const kp = keyPair();
    let t = NOW;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      keys: [{ public_key: kp.rawBase64 }, { public_key: 'AAAA' }, { kid: 'x' }],
    })));
    const source = makeCernerePublicKeySource({
      baseUrl: 'http://cernere/', ttlMs: 1000, fetchImpl: fetchImpl as typeof fetch, now: () => t,
    });
    expect(await source.keys()).toHaveLength(1);
    await source.keys();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://cernere/.well-known/cernere-public-key');
    t += 1001;
    await source.keys();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('makeServiceTokenClient', () => {
  it('issues per target, caches until 60s before expiry, and sends credentials only to Cernere', async () => {
    let t = NOW;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ accessToken: `tok-${fetchImpl.mock.calls.length}`, expiresIn: 900 })));
    const client = makeServiceTokenClient({
      cernereBaseUrl: 'http://cernere', clientId: 'cid', clientSecret: 'sec', fetchImpl: fetchImpl as typeof fetch, now: () => t,
    });
    expect(await client.getToken('EducationLab')).toBe('tok-1');
    expect(await client.getToken('EducationLab')).toBe('tok-1');
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://cernere/api/auth/service-token');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({
      client_id: 'cid', client_secret: 'sec', target_project_key: 'EducationLab',
    });
    t += 841 * 1000;
    expect(await client.getToken('EducationLab')).toBe('tok-2');
  });

  it('reports the HTTP status or network as the reason', async () => {
    const denied = makeServiceTokenClient({
      cernereBaseUrl: 'http://cernere', clientId: 'c', clientSecret: 's',
      fetchImpl: (async () => new Response('{}', { status: 403 })) as typeof fetch,
    });
    await expect(denied.getToken('x')).rejects.toMatchObject({ reason: '403' });
    const offline = makeServiceTokenClient({
      cernereBaseUrl: 'http://cernere', clientId: 'c', clientSecret: 's',
      fetchImpl: (async () => { throw new Error('down'); }) as typeof fetch,
    });
    await expect(offline.getToken('x')).rejects.toBeInstanceOf(ServiceTokenUnavailable);
  });
});

describe('makeServiceAuthHeader', () => {
  const failing = { getToken: async () => { throw new ServiceTokenUnavailable('403'); } };

  it('prefers the service token', async () => {
    const header = makeServiceAuthHeader({
      header: 'x-h', service: 's', serviceTokens: { getToken: async () => 'v4.public.t' }, targetProjectKey: 'K', fixedToken: 'fixed',
    });
    expect(await header()).toEqual({ 'x-h': 'v4.public.t' });
  });

  it('falls back to the fixed token with a logged reason only when issuance fails', async () => {
    const log = vi.fn();
    const header = makeServiceAuthHeader({ header: 'x-h', service: 's', serviceTokens: failing, targetProjectKey: 'K', fixedToken: 'secret-zz9', log });
    expect(await header()).toEqual({ 'x-h': 'secret-zz9' });
    expect(log.mock.calls[0]![0]).toContain('reason=403');
    expect(log.mock.calls[0]![0]).not.toContain('secret-zz9');
  });

  it('throws when issuance fails and no fixed token exists', async () => {
    const header = makeServiceAuthHeader({ header: 'x-h', service: 's', serviceTokens: failing, targetProjectKey: 'K', fixedToken: null });
    await expect(header()).rejects.toBeInstanceOf(ServiceTokenUnavailable);
  });
});

describe('apiAuth', () => {
  const kp = keyPair();
  const verifier = makeServiceTokenVerifier({ keySource: staticKeys(kp.publicKey), audience: 'calliope', now: () => NOW });

  function app(fixed: string | null, withVerifier: boolean) {
    const a = new Hono();
    a.use('/api/*', apiAuth(fixed, withVerifier ? verifier : null));
    a.get('/api/ping', (c) => c.json({ ok: true }));
    return a;
  }
  const call = (a: Hono, token?: string) =>
    a.request('/api/ping', token ? { headers: { authorization: `Bearer ${token}` } } : {});

  it('accepts both a valid service token and the legacy fixed token during P4', async () => {
    const a = app('fixed-token', true);
    expect((await call(a, signV4(claims(), kp.privateKey))).status).toBe(200);
    expect((await call(a, 'fixed-token')).status).toBe(200);
  });

  it('maps invalid service tokens to 401 and missing scope to 403', async () => {
    const a = app('fixed-token', true);
    expect((await call(a, signV4(claims({ aud: 'glab' }), kp.privateKey))).status).toBe(401);
    expect((await call(a, signV4(claims({ scope: [] }), kp.privateKey))).status).toBe(403);
    expect((await call(a, 'wrong')).status).toBe(401);
    expect((await call(a)).status).toBe(401);
  });

  it('requires a service token when only service token verification is configured', async () => {
    const a = app(null, true);
    expect((await call(a, signV4(claims(), kp.privateKey))).status).toBe(200);
    expect((await call(a, 'anything')).status).toBe(401);
  });

  it('keeps the legacy unauthenticated behaviour when nothing is configured', async () => {
    expect((await call(app(null, false))).status).toBe(200);
  });
});
