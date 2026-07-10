import { Hono } from 'hono';
import { z } from 'zod';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository, GoalRiskLevel } from '../db/repository.ts';
import { makeRiskEngine, RiskPrerequisiteError } from '../risk/engine.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

const refreshSchema = z.object({ sprintId: z.string().min(1).optional() });

export interface RiskRoutesDeps {
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

export function mountRiskRoutes(app: Hono, deps: RiskRoutesDeps) {
  const engine = makeRiskEngine(deps);

  app.post('/api/risk/refresh', async (c) => {
    const parsed = refreshSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    try {
      return c.json(await engine.refresh(parsed.data));
    } catch (error) {
      if (error instanceof RiskPrerequisiteError) {
        if (error.missing.length === 1 && error.missing[0] === 'actio') throw unconfigured('actio');
        return c.json({ error: 'risk_prerequisites_missing', missing: error.missing }, 400);
      }
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('sprint not found:')) return c.json({ error: 'sprint_not_found' }, 404);
      return upstreamFailure(error);
    }
  });

  app.get('/api/risk', async (c) => {
    const level = c.req.query('level');
    if (level && !['green', 'amber', 'red'].includes(level)) return c.json({ error: 'invalid_level' }, 400);
    return c.json({ snapshots: await deps.repo.listGoalRisks({
      goalRef: c.req.query('goal_ref'),
      level: level as GoalRiskLevel | undefined,
    }) });
  });
}
