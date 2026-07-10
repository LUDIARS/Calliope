import { Hono } from 'hono';
import { z } from 'zod';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { loadPlanningTasks } from '../planning/tasks.ts';
import { parseTaskRef } from '../refs.ts';
import { comparePlans } from '../reschedule/diff.ts';
import { assessRescheduleRisk } from '../reschedule/risk.ts';
import { makeSchedulerEngine, PlanningPrerequisiteError } from '../scheduler/engine.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

const taskRefKey = z.string().refine((value) => {
  try { parseTaskRef(value); return true; } catch { return false; }
}, { message: 'invalid task_ref' });

const simulateSchema = z.object({
  changes: z.object({
    lanes: z.number().int().min(1).max(64).optional(),
    priority_overrides: z.record(taskRefKey, z.number().min(0).max(1)).optional(),
    due_overrides: z.record(taskRefKey, z.string().datetime({ offset: true })).optional(),
  }).default({}),
  horizonDays: z.number().int().min(1).max(365).optional(),
});

export interface SimulateRoutesDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

export function mountSimulateRoutes(app: Hono, deps: SimulateRoutesDeps) {
  const scheduler = makeSchedulerEngine(deps);
  app.post('/api/plan/simulate', async (c) => {
    const parsed = simulateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    if (!deps.clients.actio) throw unconfigured('actio');
    const active = (await deps.repo.listPlans('active'))[0];
    if (!active) return c.json({ error: 'active_plan_missing' }, 400);
    const before = await deps.repo.getPlanWithEntries(active.id);
    if (!before) return c.json({ error: 'active_plan_missing' }, 400);
    try {
      const candidate = await scheduler.generate({
        horizonDays: parsed.data.horizonDays,
        lanes: parsed.data.changes.lanes,
        priorityOverrides: parsed.data.changes.priority_overrides,
        persist: false,
      });
      if (!candidate.plan) throw new Error('scheduler returned no simulation plan');
      const diff = comparePlans(before, candidate.plan);
      const tasks = await loadPlanningTasks(deps.clients.actio);
      const risk = assessRescheduleRisk(diff, {
        now: new Date(),
        tasks: tasks.map((task) => ({ taskRef: task.taskRef, projectRef: task.projectRef, dueAt: task.dueAt })),
        dueOverrides: parsed.data.changes.due_overrides,
      });
      const taskMeta = new Map(tasks.map((task) => [task.taskRef, task]));
      const projected = new Map<string, string>();
      for (const entry of candidate.plan.entries) {
        const projectRef = taskMeta.get(entry.taskRef)?.projectRef ?? 'unknown';
        if (!entry.endAt) continue;
        const current = projected.get(projectRef);
        if (!current || entry.endAt > current) projected.set(projectRef, entry.endAt);
      }
      return c.json({
        diff,
        risk,
        projected_completions: Object.fromEntries(projected),
        warnings: candidate.warnings,
      });
    } catch (error) {
      if (error instanceof PlanningPrerequisiteError) {
        return c.json({ error: 'planning_prerequisites_missing', missing: error.missing }, 400);
      }
      return upstreamFailure(error);
    }
  });
}
