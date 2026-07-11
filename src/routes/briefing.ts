import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeBriefingEngine } from '../briefing/engine.ts';
import { upstreamFailure } from './errors.ts';

export function mountBriefingRoutes(app: Hono, deps: { clients: CalliopeClients; repo: CalliopeRepository }) {
  const engine = makeBriefingEngine(deps);
  app.get('/api/briefing/today', async (c) => c.json(await engine.getToday()));
  app.post('/api/briefing/today/send', async (c) => {
    try {
      return c.json(await engine.sendToday());
    } catch (error) {
      return upstreamFailure(error);
    }
  });
}
