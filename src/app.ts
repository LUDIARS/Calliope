import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { CalliopeConfig } from './config.ts';
import { makeClients } from './clients/index.ts';
import { openDb } from './db/client.ts';
import { makeRepository } from './db/repository.ts';
import { mountHealthRoutes } from './routes/health.ts';
import { mountUpstreamRoutes } from './routes/upstreams.ts';

export interface CreateAppDeps {
  db?: ReturnType<typeof openDb>;
}

export function createApp(config: CalliopeConfig, deps: CreateAppDeps = {}) {
  const app = new Hono();
  const db = deps.db ?? openDb(config.dbPath);
  const repo = makeRepository(db);
  const clients = makeClients(config);

  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['content-type', 'authorization'],
  }));

  mountHealthRoutes(app, { config, clients, repo });
  mountUpstreamRoutes(app, { clients });

  return app;
}
