// Cernere service token の受け側検証 (認証集約 P4)。
//
// 照合するのは署名・kind・exp・aud (自分の storage_slug)・endpoint が要求する scope だけ。
// 呼出元名 (sub) では分岐しない — 権限は Cernere の service_scopes 宣言で決まる
// (Cernere spec/feature/service-token.md)。

import type { CernerePublicKeySource } from './cernere-public-keys.ts';
import { verifyV4Public } from './paseto-v4.ts';

export interface ServiceTokenClaims {
  kind: 'service';
  sub: string;
  aud: string;
  scope: string[];
  exp: string;
}

/** invalid = 401 (token として不正)、 forbidden = 403 (正当だが scope 不足)。 */
export class ServiceTokenRejected extends Error {
  constructor(public readonly reason: 'invalid' | 'forbidden', detail: string) {
    super(detail);
    this.name = 'ServiceTokenRejected';
  }
}

export interface ServiceTokenVerifierOptions {
  keySource: CernerePublicKeySource;
  /** 受け側自身の Cernere storage_slug。 token の aud と一致しなければ拒否する。 */
  audience: string;
  now?: () => number;
}

export type ServiceTokenVerifier = (token: string, requiredScope: string) => Promise<ServiceTokenClaims>;

export function makeServiceTokenVerifier(opts: ServiceTokenVerifierOptions): ServiceTokenVerifier {
  const now = opts.now ?? Date.now;

  async function verifySignature(token: string): Promise<Record<string, unknown>> {
    try {
      return verifyV4Public(token, await opts.keySource.keys());
    } catch (first) {
      // 鍵ローテーション直後はキャッシュが古いので 1 度だけ取り直す。
      if (!(first instanceof Error) || first.message !== 'signature mismatch') throw first;
      return verifyV4Public(token, await opts.keySource.refresh());
    }
  }

  return async (token, requiredScope) => {
    let payload: Record<string, unknown>;
    try {
      payload = await verifySignature(token);
    } catch (error) {
      throw new ServiceTokenRejected('invalid', error instanceof Error ? error.message : 'verification failed');
    }
    if (payload.kind !== 'service') throw new ServiceTokenRejected('invalid', 'not a service token');
    if (payload.aud !== opts.audience) throw new ServiceTokenRejected('invalid', 'audience mismatch');
    const expMs = typeof payload.exp === 'string' ? Date.parse(payload.exp) : Number.NaN;
    if (!Number.isFinite(expMs) || expMs <= now()) throw new ServiceTokenRejected('invalid', 'expired');
    if (typeof payload.sub !== 'string' || !payload.sub
      || !Array.isArray(payload.scope) || !payload.scope.every((s) => typeof s === 'string')) {
      throw new ServiceTokenRejected('invalid', 'malformed claims');
    }
    if (!payload.scope.includes(requiredScope)) {
      throw new ServiceTokenRejected('forbidden', `missing scope ${requiredScope}`);
    }
    return payload as unknown as ServiceTokenClaims;
  };
}
