import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { isV4PublicToken } from '../auth/paseto-v4.ts';
import { ServiceTokenRejected, type ServiceTokenVerifier } from '../auth/service-token-verifier.ts';

/** `/api/*` を呼ぶ service が Cernere の service_scopes に宣言する scope。 */
export const CALLIOPE_API_SCOPE = 'calliope-api:access';

function tokenMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/**
 * `/api/*` の認可 (認証集約 P4 の移行期間)。
 *
 * - Bearer が `v4.public.` で始まり、 service token 検証が構成されていれば Cernere service token として検証する
 *   (不正 401 / scope 不足 403)。
 * - それ以外は従来の固定トークン (`CALLIOPE_SERVICE_TOKEN`) と照合する。 P5 で撤去する経路。
 * - どちらも未構成なら従来どおり無認証で通す (起動時に警告済み)。
 */
export function apiAuth(serviceToken: string | null, verifier: ServiceTokenVerifier | null = null): MiddlewareHandler {
  return async (c, next) => {
    if (!serviceToken && !verifier) {
      await next();
      return;
    }
    const authorization = c.req.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    if (token && verifier && isV4PublicToken(token)) {
      try {
        await verifier(token, CALLIOPE_API_SCOPE);
      } catch (error) {
        if (error instanceof ServiceTokenRejected && error.reason === 'forbidden') {
          return c.json({ error: 'insufficient_scope' }, 403);
        }
        return c.json({ error: 'unauthorized' }, 401);
      }
      await next();
      return;
    }
    if (!token || !serviceToken || !tokenMatches(token, serviceToken)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}
