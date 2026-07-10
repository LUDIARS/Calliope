import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

function tokenMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function apiAuth(serviceToken: string | null): MiddlewareHandler {
  return async (c, next) => {
    if (!serviceToken) {
      await next();
      return;
    }
    const authorization = c.req.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    if (!token || !tokenMatches(token, serviceToken)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}