import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
if (!config.serviceToken) {
  console.warn('[calliope] CALLIOPE_SERVICE_TOKEN is unset; /api routes are unauthenticated');
}
const app = createApp(config);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[calliope] listening on http://localhost:${info.port}`);
  console.log(`[calliope] upstreams: actio=${config.actio.baseUrl ?? '(unset)'} ` +
    `schedula=${config.schedula.baseUrl ?? '(unset)'} memoria=${config.memoria.baseUrl ?? '(unset)'}`);
});