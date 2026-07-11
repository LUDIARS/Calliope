import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeRetrospectiveEngine } from '../retrospective/engine.ts';
import { upstreamFailure } from './errors.ts';

export function mountRetrospectiveRoutes(app: Hono, deps: {
  clients: CalliopeClients;
  repo: CalliopeRepository;
}) {
  const engine = makeRetrospectiveEngine(deps);
  app.get('/api/retrospective/weekly', async (c) => c.json(await engine.getWeekly()));
  app.post('/api/retrospective/weekly/send', async (c) => {
    try {
      return c.json(await engine.sendWeekly());
    } catch (error) {
      return upstreamFailure(error);
    }
  });
}
