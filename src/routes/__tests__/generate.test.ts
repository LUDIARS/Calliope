import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.ts';
import type { CalliopeConfig } from '../../config.ts';
import type { CalliopeDb } from '../../db/client.ts';
import { makeRepository } from '../../db/repository.ts';
import * as schema from '../../db/schema.ts';

const databases: Database.Database[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});

function testDb(): CalliopeDb {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE connector_state (service TEXT PRIMARY KEY, health TEXT NOT NULL, last_sync_at TEXT, cursor TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE velocity (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, category TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, k_factor REAL NOT NULL, throughput REAL NOT NULL, distribution TEXT NOT NULL, sample_size INTEGER NOT NULL, source TEXT NOT NULL);
    CREATE TABLE priority (id TEXT PRIMARY KEY, scope TEXT NOT NULL, ref TEXT NOT NULL, resolved_score REAL NOT NULL, breakdown TEXT NOT NULL, first_ready_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE plan (id TEXT PRIMARY KEY, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL, status TEXT NOT NULL, velocity_snapshot TEXT NOT NULL, created_at TEXT NOT NULL, superseded_by TEXT);
    CREATE TABLE plan_entry (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plan(id) ON DELETE CASCADE, task_ref TEXT NOT NULL, start_at TEXT, end_at TEXT, lane TEXT NOT NULL, seq INTEGER NOT NULL, schedula_event_id TEXT, confidence REAL NOT NULL, is_human_gate INTEGER NOT NULL);
    CREATE TABLE sprint (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL, target_velocity REAL NOT NULL, gompertz_snapshot TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);
    CREATE TABLE sprint_task (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL REFERENCES sprint(id) ON DELETE CASCADE, task_ref TEXT NOT NULL, effort_minutes INTEGER NOT NULL, priority_score REAL NOT NULL, status TEXT NOT NULL, status_history TEXT NOT NULL, committed_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE curve_snapshot (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL REFERENCES sprint(id) ON DELETE CASCADE, date TEXT NOT NULL, gompertz_params TEXT NOT NULL, inflow_lambda REAL NOT NULL, burndown_actual REAL NOT NULL, burndown_planned REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE goal_risk_snapshot (id TEXT PRIMARY KEY, goal_ref TEXT NOT NULL, date TEXT NOT NULL, projected_completion TEXT NOT NULL, deadline TEXT NOT NULL, level TEXT NOT NULL, factors TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX uq_goal_risk_snapshot_day ON goal_risk_snapshot(goal_ref, date);
    CREATE TABLE reschedule_log (id TEXT PRIMARY KEY, trigger TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, applied_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'applied', confirmation_id TEXT);
    CREATE TABLE confirmation (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decision_reason TEXT);
  `);
  return drizzle(sqlite, { schema });
}

function config(overrides: Partial<CalliopeConfig> = {}): CalliopeConfig {
  return {
    port: 0, dbPath: ':memory:', agentLanes: 2, serviceToken: null, llmEstimation: false,
    actio: { baseUrl: 'http://actio.test', token: null },
    schedula: { baseUrl: null, token: null },
    memoria: { baseUrl: null, token: null },
    concordiaBaseUrl: null, nuntiusBaseUrl: null, claudeBin: 'claude',
    ...overrides,
  };
}

/** Actio に残っているのは actio:alive のみ (actio:gone は削除済みという fixture)。 */
const ACTIO_TASKS = [{
  id: 'alive', title: 'Alive task', description: null, requirements: null, status: 'open',
  kind: 'task', creatorType: 'ai', category: 'p1', priority: 'medium', deadline: null,
  estimatedMinutes: null, pluginId: null, pluginRef: null, projectId: null,
  completedAt: null, createdAt: '2026-07-01T00:00:00.000Z',
}];

function mockActio() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/pm/projects')) return Response.json({ projects: [] });
    if (url.endsWith('/api/tasks') && method === 'GET') return Response.json({ tasks: ACTIO_TASKS });
    if (url.endsWith('/api/tasks') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ task: {
        ...ACTIO_TASKS[0],
        id: `created-${String(body.external_id)}`,
        title: String(body.title),
        category: body.category ?? null,
      } });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
}

async function seedSignals(db: CalliopeDb) {
  const repo = makeRepository(db);
  await repo.createSprintWithTasks({
    id: 'sprint-1', projectRef: 'p1', goalRef: 'actio:goal-1',
    periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-07-14T00:00:00.000Z',
    targetVelocity: 1, gompertzSnapshot: {}, status: 'closed',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z',
  }, [
    { id: 'st-1', sprintId: 'sprint-1', taskRef: 'actio:gone', effortMinutes: 60, priorityScore: 1, status: 'committed', statusHistory: [], committedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'st-2', sprintId: 'sprint-1', taskRef: 'actio:alive', effortMinutes: 60, priorityScore: 1, status: 'committed', statusHistory: [], committedAt: '2026-07-01T00:00:00.000Z' },
  ]);
  await repo.upsertGoalRiskSnapshot({
    id: 'risk-1', goalRef: 'actio:goal-1', date: '2026-07-20',
    projectedCompletion: '2026-08-10T00:00:00.000Z', deadline: '2026-07-31T00:00:00.000Z',
    level: 'red', factors: {}, createdAt: '2026-07-20T00:00:00.000Z',
  });
  return repo;
}

describe('task generation routes (task-lifecycle §G2)', () => {
  it('POST detects candidates, dedupes existing tasks, and stacks a task_create confirmation', async () => {
    mockActio();
    const db = testDb();
    const repo = await seedSignals(db);
    const app = createApp(config(), { db });

    const response = await app.request('/api/tasks/generate', { method: 'POST' });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      report: { summary: Record<string, number>; candidates: Array<{ key: string }>; suppressed: unknown[] };
      confirmation: { id: string; kind: string };
      warnings: string[];
    };
    expect(body.confirmation.kind).toBe('task_create');
    expect(body.warnings).toEqual([]);
    // actio:gone (carryover) + actio:goal-1 (risk red) の 2 件。 actio:alive は既存なので抑止。
    expect(body.report.summary).toMatchObject({ sprintCarryover: 1, riskRed: 1, candidates: 2, suppressed: 1 });
    expect(body.report.candidates.map((c) => c.key))
      .toEqual(['sprint_carryover|actio:gone', 'risk_red|actio:goal-1']);
    expect((await repo.getConfirmation(body.confirmation.id))?.status).toBe('pending');
  });

  it('suppresses re-proposal while a task_create confirmation is pending', async () => {
    mockActio();
    const db = testDb();
    await seedSignals(db);
    const app = createApp(config(), { db });

    await app.request('/api/tasks/generate', { method: 'POST' });
    const second = await app.request('/api/tasks/generate', { method: 'POST' });
    const body = await second.json() as {
      report: { summary: Record<string, number> };
      confirmation: unknown;
    };
    expect(body.report.summary).toMatchObject({ candidates: 0, suppressed: 3 });
    expect(body.confirmation).toBeNull();
  });

  it('approve creates the tasks in Actio and records the ids in the payload', async () => {
    const fetchMock = mockActio();
    const db = testDb();
    const repo = await seedSignals(db);
    const app = createApp(config(), { db });

    const generated = await app.request('/api/tasks/generate', { method: 'POST' });
    const { confirmation } = await generated.json() as { confirmation: { id: string } };

    const approval = await app.request(`/api/confirmations/${confirmation.id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(approval.status).toBe(200);
    const body = await approval.json() as { result: { outcomes: Array<Record<string, unknown>> } };
    expect(body.result.outcomes).toEqual([
      {
        key: 'sprint_carryover|actio:gone', source: 'sprint_carryover', status: 'created',
        taskId: 'created-calliope-taskgen-sprint-carryover-actio-gone',
        taskRef: 'actio:created-calliope-taskgen-sprint-carryover-actio-gone',
        title: 'Restore carryover task actio:gone',
      },
      {
        key: 'risk_red|actio:goal-1', source: 'risk_red', status: 'created',
        taskId: 'created-calliope-taskgen-risk-red-actio-goal-1',
        taskRef: 'actio:created-calliope-taskgen-risk-red-actio-goal-1',
        title: 'Risk mitigation for actio:goal-1',
      },
    ]);
    const stored = await repo.getConfirmation(confirmation.id);
    expect(stored?.status).toBe('approved');
    expect((stored?.payload as { result?: unknown }).result).toBeDefined();

    const posts = fetchMock.mock.calls
      .filter(([url, init]) => init?.method === 'POST' && String(url).endsWith('/api/tasks'))
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      source: 'calliope', creator_type: 'ai', status: 'open', kind: 'task', category: 'p1',
      external_id: 'calliope-taskgen-sprint-carryover-actio-gone', due_at: null,
    });
    expect(posts[1]).toMatchObject({ due_at: '2026-07-31T00:00:00.000Z', category: null });
  });

  it('rejecting a task_create confirmation requires a reason and creates nothing', async () => {
    const fetchMock = mockActio();
    const db = testDb();
    const repo = await seedSignals(db);
    const app = createApp(config(), { db });

    const generated = await app.request('/api/tasks/generate', { method: 'POST' });
    const { confirmation } = await generated.json() as { confirmation: { id: string } };

    const missing = await app.request(`/api/confirmations/${confirmation.id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'reject' }),
    });
    expect(missing.status).toBe(400);

    const rejected = await app.request(`/api/confirmations/${confirmation.id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'reject', reason: 'not needed this sprint' }),
    });
    expect(rejected.status).toBe(200);
    expect((await repo.getConfirmation(confirmation.id))?.status).toBe('rejected');
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      init?.method === 'POST' && String(url).endsWith('/api/tasks'))).toHaveLength(0);
  });

  it('returns 503 actio_unconfigured when Actio is not set (no silent fallback)', async () => {
    const db = testDb();
    const app = createApp(config({ actio: { baseUrl: null, token: null } }), { db });
    const response = await app.request('/api/tasks/generate', { method: 'POST' });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'actio_unconfigured' });
  });

  it('maps an Actio upstream failure to 502 instead of swallowing it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'boom' }, { status: 500 }),
    );
    const db = testDb();
    const app = createApp(config(), { db });
    const response = await app.request('/api/tasks/generate', { method: 'POST' });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: 'upstream_error', service: 'actio' });
  });
});
