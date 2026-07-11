import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { CalliopeClients } from './clients/index.ts';
import { makeClients } from './clients/index.ts';
import type { CalliopeConfig } from './config.ts';
import { openDb } from './db/client.ts';
import { makeRepository } from './db/repository.ts';
import { apiAuth } from './routes/auth.ts';
import { mountEstimateRoutes } from './routes/estimates.ts';
import { mountConfirmationRoutes } from './routes/confirmations.ts';
import { mountBriefingRoutes } from './routes/briefing.ts';
import { mountCalendarRoutes } from './routes/calendar.ts';
import { mountHealthRoutes } from './routes/health.ts';
import { mountPlanRoutes } from './routes/plan.ts';
import { mountPriorityRoutes } from './routes/priority.ts';
import { mountRescheduleRoutes } from './routes/reschedule.ts';
import { mountRiskRoutes } from './routes/risk.ts';
import { mountSprintRoutes } from './routes/sprint.ts';
import { mountSimulateRoutes } from './routes/simulate.ts';
import { mountUpstreamRoutes } from './routes/upstreams.ts';
import { mountVelocityRoutes } from './routes/velocity.ts';
import { mountRetrospectiveRoutes } from './routes/retrospective.ts';
import { mountUiRoutes } from './routes/ui.ts';

export interface CreateAppDeps {
  db?: ReturnType<typeof openDb>;
  clients?: CalliopeClients;
}

export function createApp(config: CalliopeConfig, deps: CreateAppDeps = {}) {
  const app = new Hono();
  const db = deps.db ?? openDb(config.dbPath);
  const repo = makeRepository(db);
  const clients = deps.clients ?? makeClients(config);

  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['content-type', 'authorization'],
  }));
  app.use('/api/*', apiAuth(config.serviceToken));
  mountUiRoutes(app);

  mountHealthRoutes(app, { config, clients, repo });
  mountUpstreamRoutes(app, { clients });
  mountVelocityRoutes(app, { clients, repo });
  mountEstimateRoutes(app, { config, clients, repo });
  mountPriorityRoutes(app, { clients, repo });
  mountPlanRoutes(app, { config, clients, repo });
  mountSimulateRoutes(app, { config, clients, repo });
  mountSprintRoutes(app, { config, clients, repo });
  mountRiskRoutes(app, { clients, repo });
  mountRescheduleRoutes(app, { config, clients, repo });
  mountConfirmationRoutes(app, { config, clients, repo });
  mountBriefingRoutes(app, { clients, repo });
  mountCalendarRoutes(app, { config, clients, repo });
  mountRetrospectiveRoutes(app, { clients, repo });

  return app;
}
