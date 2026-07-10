import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeVelocityEngine } from '../velocity/engine.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

export interface VelocityRoutesDeps {
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

export function mountVelocityRoutes(app: Hono, deps: VelocityRoutesDeps) {
  app.post('/api/velocity/refresh', async (c) => {
    try {
      if (!deps.clients.actio) throw unconfigured('actio');
      if (!deps.clients.memoria) throw unconfigured('memoria');
      const engine = makeVelocityEngine({
        actio: deps.clients.actio,
        memoria: deps.clients.memoria,
        repo: deps.repo,
      });
      return c.json(await engine.refresh());
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/velocity', async (c) => {
    const rows = await deps.repo.listLatestVelocity({
      projectRef: c.req.query('project'),
      category: c.req.query('category'),
    });
    return c.json({ rows });
  });

  app.get('/api/velocity/accuracy', async (c) => {
    const rows = await deps.repo.listLatestVelocity({
      projectRef: c.req.query('project'),
      category: c.req.query('category'),
    });
    return c.json({
      rows: rows.map((row) => ({
        projectRef: row.projectRef,
        category: row.category,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        accuracyBySource: (row.distribution as { accuracyBySource?: unknown }).accuracyBySource ?? {},
      })),
    });
  });
}