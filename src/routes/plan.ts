import { Hono } from 'hono';
import { z } from 'zod';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeEstimationEngine } from '../estimation/engine.ts';
import { makePriorityEngine } from '../priority/engine.ts';
import { DagCycleError } from '../scheduler/dag.ts';
import { makeSchedulerEngine, PlanningPrerequisiteError } from '../scheduler/engine.ts';
import { makeVelocityEngine } from '../velocity/engine.ts';
import { parseTaskRef } from '../refs.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

const taskRefSchema = z.string().min(1).refine((value) => {
  try { parseTaskRef(value); return true; } catch { return false; }
}, { message: 'invalid task_ref' });

const generateSchema = z.object({
  goalRefs: z.array(taskRefSchema).optional(),
  horizonDays: z.number().int().min(1).max(365).optional(),
});

export interface PlanRoutesDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

async function refreshPlanningInputs(deps: PlanRoutesDeps): Promise<void> {
  if (!deps.clients.actio) throw unconfigured('actio');
  if (!deps.clients.memoria) throw unconfigured('memoria');
  await makeEstimationEngine({
    actio: deps.clients.actio,
    memoria: deps.clients.memoria,
    repo: deps.repo,
    claudeBin: deps.config.claudeBin,
    llmEnabled: deps.config.llmEstimation,
  }).refresh();
  await makeVelocityEngine({
    actio: deps.clients.actio,
    memoria: deps.clients.memoria,
    repo: deps.repo,
  }).refresh();
  await makePriorityEngine({
    actio: deps.clients.actio,
    memoria: deps.clients.memoria,
    repo: deps.repo,
  }).refresh();
}

export function mountPlanRoutes(app: Hono, deps: PlanRoutesDeps) {
  const scheduler = makeSchedulerEngine(deps);

  app.post('/api/plan/generate', async (c) => {
    const parsed = generateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    }
    try {
      if (c.req.query('refresh') === 'true') await refreshPlanningInputs(deps);
      return c.json(await scheduler.generate(parsed.data), 201);
    } catch (error) {
      if (error instanceof DagCycleError) {
        return c.json({ error: 'dependency_cycle', task_refs: error.taskRefs }, 422);
      }
      if (error instanceof PlanningPrerequisiteError) {
        if (error.missing.length === 1 && error.missing[0] === 'actio') throw unconfigured('actio');
        return c.json({
          error: 'planning_prerequisites_missing',
          missing: error.missing,
          hint: 'Refresh estimates and priority, or retry with ?refresh=true.',
        }, 400);
      }
      return upstreamFailure(error);
    }
  });

  app.get('/api/plan', async (c) => {
    const status = c.req.query('status');
    if (status && status !== 'draft' && status !== 'active' && status !== 'superseded') {
      return c.json({ error: 'invalid_status' }, 400);
    }
    return c.json({ plans: await deps.repo.listPlans(status as 'draft' | 'active' | 'superseded' | undefined) });
  });

  app.get('/api/plan/:id', async (c) => {
    const plan = await deps.repo.getPlanWithEntries(c.req.param('id'));
    return plan ? c.json({ plan }) : c.json({ error: 'plan_not_found' }, 404);
  });

  app.post('/api/plan/:id/apply', async (c) => {
    try {
      return c.json(await scheduler.apply(c.req.param('id')));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('plan not found:')) return c.json({ error: 'plan_not_found' }, 404);
      if (message.startsWith('plan is not draft:')) return c.json({ error: 'plan_not_draft' }, 409);
      throw error;
    }
  });
}