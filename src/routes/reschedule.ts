import { Hono } from 'hono';
import { z } from 'zod';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeRescheduleEngine, ReschedulePrerequisiteError } from '../reschedule/engine.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

const triggerSchema = z.object({
  trigger: z.enum(['manual', 'task_change', 'estimate_change', 'deadline_change', 'velocity_drift',
    'priority_interrupt', 'dependency_change', 'daily', 'confirmation_expired']).default('manual'),
  projectRef: z.string().min(1).optional(),
  horizonDays: z.number().int().min(1).max(365).optional(),
  refresh: z.boolean().optional(),
});

export interface RescheduleRoutesDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

export function mountRescheduleRoutes(app: Hono, deps: RescheduleRoutesDeps) {
  const engine = makeRescheduleEngine(deps);
  app.post('/api/reschedule/trigger', async (c) => {
    const parsed = triggerSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    try {
      const result = await engine.trigger(parsed.data);
      if (result.outcome === 'confirmation_required') {
        return c.json({ error: 'human_confirmation_required', ...result }, 409);
      }
      return c.json(result);
    } catch (error) {
      if (error instanceof ReschedulePrerequisiteError) {
        if (error.missing.length === 1 && ['actio', 'memoria'].includes(error.missing[0] ?? '')) {
          throw unconfigured(error.missing[0] ?? 'upstream');
        }
        return c.json({ error: 'reschedule_prerequisites_missing', missing: error.missing }, 400);
      }
      return upstreamFailure(error);
    }
  });

  app.get('/api/reschedule/log', async (c) => c.json({ logs: await deps.repo.listRescheduleLogs() }));
}
