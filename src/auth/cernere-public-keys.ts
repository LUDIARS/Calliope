// Cernere の検証用公開鍵 (`/.well-known/cernere-public-key`) の取得とキャッシュ。
//
// Cernere は現行鍵とローテーション中の旧鍵を並べて返す。 応答の cache-control は 600 秒なので、
// 既定のキャッシュ期間も 10 分に揃える。 署名不一致時に呼び出し側が refresh() で取り直せる。

import type { KeyObject } from 'node:crypto';
import { ed25519KeyFromRaw } from './paseto-v4.ts';

export interface CernerePublicKeySource {
  keys(): Promise<KeyObject[]>;
  refresh(): Promise<KeyObject[]>;
}

export interface CernerePublicKeySourceOptions {
  baseUrl: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function makeCernerePublicKeySource(opts: CernerePublicKeySourceOptions): CernerePublicKeySource {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/.well-known/cernere-public-key`;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { keys: KeyObject[]; fetchedAt: number } | null = null;

  async function refresh(): Promise<KeyObject[]> {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`cernere public key fetch -> HTTP ${res.status}`);
    }
    const body = await res.json() as { keys?: Array<{ public_key?: unknown }> };
    const keys: KeyObject[] = [];
    for (const entry of body.keys ?? []) {
      if (typeof entry.public_key !== 'string') continue;
      const raw = Buffer.from(entry.public_key, 'base64');
      if (raw.length === 32) keys.push(ed25519KeyFromRaw(raw));
    }
    if (keys.length === 0) throw new Error('cernere public key response has no usable key');
    cached = { keys, fetchedAt: now() };
    return keys;
  }

  return {
    keys: async () => (cached && now() - cached.fetchedAt < ttlMs ? cached.keys : refresh()),
    refresh,
  };
}
