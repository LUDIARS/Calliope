import { Hono } from 'hono';
import { z } from 'zod';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository, SprintStatus } from '../db/repository.ts';
import { parseTaskRef } from '../refs.ts';
import { makeRiskEngine, RiskPrerequisiteError } from '../risk/engine.ts';
import { makeSprintEngine, SprintPrerequisiteError } from '../sprint/engine.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

const taskRefSchema = z.string().min(1).refine((value) => {
  try { parseTaskRef(value); return true; } catch { return false; }
}, { message: 'invalid task_ref' });

const createSchema = z.object({
  projectRef: z.string().min(1),
  goalRef: taskRefSchema.optional(),
  sprintDays: z.number().int().min(1).max(28).optional(),
});

const closeSchema = z.object({
  createNext: z.boolean().optional(),
  goalAchieved: z.boolean().optional(),
});

export interface SprintRoutesDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

function handleSprintError(error: unknown): Response {
  if (error instanceof SprintPrerequisiteError || error instanceof RiskPrerequisiteError) {
    if (error.missing.length === 1 && error.missing[0] === 'actio') throw unconfigured('actio');
    if (error.missing.length === 1 && error.missing[0] === '<private-reference-004>') throw unconfigured('<private-reference-004>');
    return Response.json({
      error: 'sprint_prerequisites_missing',
      missing: error.missing,
      hint: 'Refresh estimates, priority, and velocity before designing a sprint.',
    }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('project not found:')) return Response.json({ error: 'project_not_found' }, { status: 404 });
  if (message.startsWith('sprint not found:')) return Response.json({ error: 'sprint_not_found' }, { status: 404 });
  if (message.startsWith('active sprint exists:')) {
    return Response.json({ error: 'active_sprint_exists', sprint_id: message.slice(message.lastIndexOf(':') + 1).trim() }, { status: 409 });
  }
  if (message.startsWith('sprint is not planned:') || message.startsWith('sprint is closed:') ||
    message.startsWith('sprint is not active:')) {
    return Response.json({ error: 'invalid_sprint_state' }, { status: 409 });
  }
  return upstreamFailure(error);
}

export function mountSprintRoutes(app: Hono, deps: SprintRoutesDeps) {
  const engine = makeSprintEngine({
    clients: deps.clients,
    repo: deps.repo,
    agentLanes: deps.config.agentLanes,
  });
  const risk = makeRiskEngine(deps);

  app.post('/api/sprint', async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    try {
      return c.json(await engine.design(parsed.data), 201);
    } catch (error) {
      return handleSprintError(error);
    }
  });

  app.get('/api/sprint', async (c) => {
    const status = c.req.query('status');
    if (status && !['planned', 'active', 'closed'].includes(status)) return c.json({ error: 'invalid_status' }, 400);
    return c.json({ sprints: await deps.repo.listSprints({
      projectRef: c.req.query('project_ref'),
      status: status as SprintStatus | undefined,
    }) });
  });

  app.get('/api/sprint/:id', async (c) => {
    const sprint = await deps.repo.getSprintWithTasks(c.req.param('id'));
    return sprint ? c.json({ sprint }) : c.json({ error: 'sprint_not_found' }, 404);
  });

  app.post('/api/sprint/:id/activate', async (c) => {
    try {
      return c.json({ sprint: await engine.activate(c.req.param('id')) });
    } catch (error) {
      return handleSprintError(error);
    }
  });

  app.post('/api/sprint/:id/replan', async (c) => {
    try {
      const result = await engine.replan(c.req.param('id'));
      const riskResult = await risk.refresh({ sprintId: c.req.param('id') });
      return c.json({ ...result, risk: riskResult });
    } catch (error) {
      return handleSprintError(error);
    }
  });

  app.post('/api/sprint/:id/close', async (c) => {
    const parsed = closeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    try {
      return c.json(await engine.close(c.req.param('id'), parsed.data));
    } catch (error) {
      return handleSprintError(error);
    }
  });
}
