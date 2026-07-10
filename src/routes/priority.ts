import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository, PriorityScope } from '../db/repository.ts';
import { makePriorityEngine } from '../priority/engine.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

const SCOPES = new Set<PriorityScope>(['project', 'goal', 'task']);

export interface PriorityRoutesDeps {
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

export function mountPriorityRoutes(app: Hono, deps: PriorityRoutesDeps) {
  app.post('/api/priority/refresh', async (c) => {
    try {
      if (!deps.clients.actio) throw unconfigured('actio');
      if (!deps.clients.memoria) throw unconfigured('memoria');
      const engine = makePriorityEngine({
        actio: deps.clients.actio,
        memoria: deps.clients.memoria,
        repo: deps.repo,
      });
      return c.json(await engine.refresh());
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/priority', async (c) => {
    const rawScope = c.req.query('scope');
    if (rawScope && !SCOPES.has(rawScope as PriorityScope)) {
      return c.json({ error: 'invalid_scope' }, 400);
    }
    return c.json({
      priorities: await deps.repo.listPriorities({
        scope: rawScope as PriorityScope | undefined,
        ref: c.req.query('ref'),
      }),
    });
  });
}