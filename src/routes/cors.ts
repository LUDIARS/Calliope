import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { CalliopeConfig } from '../config.ts';

const SERVICE_MAP_PREFIX = '/service-map';
const API_PREFIX = '/api';

function isServiceMapPath(path: string): boolean {
  return path === SERVICE_MAP_PREFIX || path.startsWith(`${SERVICE_MAP_PREFIX}/`);
}

function isApiPath(path: string): boolean {
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}

/**
 * CORS の許可オリジンを経路ごとに決める。 経路で扱いが割れるのは、 同じ origin に
 * 認可条件の違う 3 種類の面が載っているため。
 *
 * - `/service-map` … 常に不許可。 認可は Cloudflare Access が正で admin Bearer は
 *   任意の追加ゲートでしかなく、 ワイルドカードのままだと利用者のブラウザに開いた
 *   任意のサイトから台帳を read/mutate できてしまう
 *   (spec/plan/problem_logs/2026-08-23-service-map-exposure-and-import-collision.md)。
 * - `/api/*` … `CALLIOPE_CORS_ORIGINS` の allowlist に載ったオリジンだけ許可。
 *   confirmation approve / reschedule / calendar write のような副作用を持ち、
 *   service token 未設定の開発モードでは任意サイトから叩けてしまうため、
 *   クロスオリジン利用は明示的な opt-in にする。 既定は空 = 同一オリジンのみ。
 * - それ以外 (`/health`・同一オリジン配信のダッシュボード資産) … 従来どおり許可する。
 *
 * @spec 認証 / CORS
 */
export function resolveCorsOrigin(
  path: string,
  origin: string,
  allowlist: readonly string[],
): string | null {
  if (isServiceMapPath(path)) return null;
  if (isApiPath(path)) return allowlist.includes(origin) ? origin : null;
  return '*';
}

export function mountCors(app: Hono, deps: { config: CalliopeConfig }) {
  const allowlist = deps.config.corsOrigins ?? [];
  app.use('*', cors({
    origin: (origin, c) => resolveCorsOrigin(c.req.path, origin, allowlist),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['content-type', 'authorization'],
  }));
}
