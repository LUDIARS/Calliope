// Calliope エントリ。Hono app 生成 → route mount → serve。
// P0 scaffold は /health のみ。plan/reschedule/sprint/velocity/calendar の各 route は
// Codex 委託(docs/CODEX-P0.md 以降)で mount*Routes として追加する。

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = new Hono();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization'],
}));

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'calliope',
    port: config.port,
    upstreams: {
      actio: Boolean(config.actio.baseUrl),
      schedula: Boolean(config.schedula.baseUrl),
      memoria: Boolean(config.memoria.baseUrl),
    },
  }),
);

// TODO(Codex P0+): mountPlanRoutes / mountRescheduleRoutes / mountSprintRoutes /
//                  mountVelocityRoutes / mountCalendarRoutes を追加。

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[calliope] listening on http://localhost:${info.port}`);
  console.log(`[calliope] upstreams: actio=${config.actio.baseUrl ?? '(unset)'} ` +
    `schedula=${config.schedula.baseUrl ?? '(unset)'} memoria=${config.memoria.baseUrl ?? '(unset)'}`);
});
