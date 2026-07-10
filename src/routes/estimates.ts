import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeEstimationEngine } from '../estimation/engine.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

export interface EstimateRoutesDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

export function mountEstimateRoutes(app: Hono, deps: EstimateRoutesDeps) {
  app.post('/api/estimates/refresh', async (c) => {
    try {
      if (!deps.clients.actio) throw unconfigured('actio');
      const engine = makeEstimationEngine({
        actio: deps.clients.actio,
        memoria: deps.clients.memoria,
        repo: deps.repo,
        claudeBin: deps.config.claudeBin,
        llmEnabled: deps.config.llmEstimation,
      });
      return c.json(await engine.refresh());
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/estimates', async (c) => {
    const taskRef = c.req.query('task_ref');
    if (taskRef) {
      const estimate = await deps.repo.getTaskEstimate(taskRef);
      return estimate ? c.json({ estimate }) : c.json({ error: 'estimate_not_found' }, 404);
    }
    return c.json({ estimates: await deps.repo.listTaskEstimates() });
  });
}