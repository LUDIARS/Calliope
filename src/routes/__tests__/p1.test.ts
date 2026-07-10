import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.ts';
import type { CalliopeConfig } from '../../config.ts';
import type { CalliopeDb } from '../../db/client.ts';
import { makeRepository } from '../../db/repository.ts';
import * as schema from '../../db/schema.ts';
import { makeTaskRef } from '../../refs.ts';

const openDatabases: Database.Database[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const sqlite of openDatabases.splice(0)) sqlite.close();
});

function testDb(): CalliopeDb {
  const sqlite = new Database(':memory:');
  openDatabases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE connector_state (
      service TEXT PRIMARY KEY, health TEXT NOT NULL DEFAULT 'unknown',
      last_sync_at TEXT, cursor TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE plan (
      id TEXT PRIMARY KEY, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', velocity_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL, superseded_by TEXT
    );
    CREATE TABLE plan_entry (
      id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plan(id), task_ref TEXT NOT NULL,
      start_at TEXT, end_at TEXT, lane TEXT NOT NULL, seq INTEGER NOT NULL,
      schedula_event_id TEXT, confidence REAL NOT NULL, is_human_gate INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE velocity (
      id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, category TEXT NOT NULL,
      window_start TEXT NOT NULL, window_end TEXT NOT NULL, k_factor REAL NOT NULL,
      throughput REAL NOT NULL, distribution TEXT NOT NULL, sample_size INTEGER NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE task_estimate (
      task_ref TEXT PRIMARY KEY, effort_minutes INTEGER NOT NULL, estimate_source TEXT NOT NULL,
      confidence REAL NOT NULL, estimated_at TEXT NOT NULL
    );
    CREATE TABLE priority (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, ref TEXT NOT NULL, resolved_score REAL NOT NULL,
      breakdown TEXT NOT NULL, first_ready_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE reschedule_log (
      id TEXT PRIMARY KEY, trigger TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL,
      applied_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite, { schema });
}

function config(overrides: Partial<CalliopeConfig> = {}): CalliopeConfig {
  return {
    port: 0,
    dbPath: ':memory:',
    agentLanes: 2,
    serviceToken: null,
    llmEstimation: false,
    actio: { baseUrl: null, token: null },
    schedula: { baseUrl: null, token: null },
    memoria: { baseUrl: null, token: null },
    concordiaBaseUrl: null,
    nuntiusBaseUrl: null,
    claudeBin: 'claude',
    ...overrides,
  };
}

function mockActio(fixtures: {
  tasks?: unknown[];
  projects?: unknown[];
  pmTasks?: unknown[];
}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/tasks')) return Response.json({ tasks: fixtures.tasks ?? [] });
    if (url.endsWith('/api/pm/projects')) return Response.json({ projects: fixtures.projects ?? [] });
    if (/\/api\/pm\/projects\/[^/]+\/tasks$/.test(url)) {
      return Response.json({ tasks: fixtures.pmTasks ?? [] });
    }
    return Response.json({ ok: true });
  });
}

describe('P1 routes', () => {
  it('requires the service token for /api but keeps /health public', async () => {
    const app = createApp(config({ serviceToken: 'secret' }), { db: testDb() });
    expect((await app.request('/api/priority')).status).toBe(401);
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/api/priority', {
      headers: { authorization: 'Bearer secret' },
    })).status).toBe(200);
  });

  it('generates, applies, and supersedes plans transactionally', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    const taskRef = makeTaskRef('actio', 'task-1');
    await repo.upsertTaskEstimate({
      taskRef,
      effortMinutes: 60,
      estimateSource: 'human',
      confidence: 1,
      estimatedAt: '2026-07-10T00:00:00.000Z',
    });
    await repo.upsertPriority({
      scope: 'task',
      ref: taskRef,
      resolvedScore: 0.8,
      breakdown: {},
      firstReadyAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    });
    mockActio({
      tasks: [{
        id: 'task-1',
        title: 'Implement feature',
        description: null,
        requirements: null,
        status: 'open',
        kind: 'task',
        creatorType: 'ai',
        category: 'calliope',
        priority: 'high',
        deadline: null,
        estimatedMinutes: 60,
        pluginId: null,
        pluginRef: null,
        completedAt: null,
        createdAt: '2026-07-10T00:00:00.000Z',
      }],
    });
    const app = createApp(config({ actio: { baseUrl: 'http://actio.test', token: null } }), { db });

    const firstResponse = await app.request('/api/plan/generate', { method: 'POST', body: '{}' });
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as { plan: { id: string; entries: unknown[] }; warnings: unknown };
    expect(first.plan.entries).toHaveLength(1);
    expect((await app.request(`/api/plan/${first.plan.id}/apply`, { method: 'POST' })).status).toBe(200);

    const secondResponse = await app.request('/api/plan/generate', { method: 'POST', body: '{}' });
    const second = await secondResponse.json() as { plan: { id: string } };
    expect((await app.request(`/api/plan/${second.plan.id}/apply`, { method: 'POST' })).status).toBe(200);

    const oldPlanResponse = await app.request(`/api/plan/${first.plan.id}`);
    const oldPlan = await oldPlanResponse.json() as { plan: { status: string; supersededBy: string } };
    expect(oldPlan.plan).toMatchObject({ status: 'superseded', supersededBy: second.plan.id });
    expect(await repo.listRescheduleLogs()).toHaveLength(2);
  });

  it('returns 422 with canonical refs for a PM dependency cycle', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    const aRef = makeTaskRef('actio-pm', 'p1', 'A');
    const bRef = makeTaskRef('actio-pm', 'p1', 'B');
    for (const ref of [aRef, bRef]) {
      await repo.upsertTaskEstimate({
        taskRef: ref,
        effortMinutes: 60,
        estimateSource: 'human',
        confidence: 1,
        estimatedAt: '2026-07-10T00:00:00.000Z',
      });
      await repo.upsertPriority({
        scope: 'task',
        ref,
        resolvedScore: 0.5,
        breakdown: {},
        firstReadyAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      });
    }
    mockActio({
      projects: [{ id: 'p1', name: 'Calliope' }],
      pmTasks: [
        {
          id: 'internal-a', projectId: 'p1', externalId: 'A', title: 'A', description: null,
          status: 'open', priority: 'medium', labels: [], dueDate: null,
          milestoneExternalId: null, milestoneName: null, estimatedHours: 1,
          blockedBy: ['internal-b'], createdAt: '2026-07-10T00:00:00.000Z',
        },
        {
          id: 'internal-b', projectId: 'p1', externalId: 'B', title: 'B', description: null,
          status: 'open', priority: 'medium', labels: [], dueDate: null,
          milestoneExternalId: null, milestoneName: null, estimatedHours: 1,
          blockedBy: ['internal-a'], createdAt: '2026-07-10T00:00:00.000Z',
        },
      ],
    });
    const app = createApp(config({ actio: { baseUrl: 'http://actio.test', token: null } }), { db });
    const response = await app.request('/api/plan/generate', { method: 'POST', body: '{}' });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: 'dependency_cycle',
      task_refs: expect.arrayContaining([aRef, bRef]),
    });
  });


  it('excludes unestimated PM tasks and their dependents with explicit warnings', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    const aRef = makeTaskRef('actio-pm', 'p1', 'A');
    const bRef = makeTaskRef('actio-pm', 'p1', 'B');
    await repo.upsertTaskEstimate({
      taskRef: bRef,
      effortMinutes: 60,
      estimateSource: 'human',
      confidence: 1,
      estimatedAt: '2026-07-10T00:00:00.000Z',
    });
    for (const ref of [aRef, bRef]) {
      await repo.upsertPriority({
        scope: 'task',
        ref,
        resolvedScore: 0.5,
        breakdown: {},
        firstReadyAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      });
    }
    mockActio({
      projects: [{ id: 'p1', name: 'Calliope' }],
      pmTasks: [
        {
          id: 'internal-a', projectId: 'p1', externalId: 'A', title: 'A', description: null,
          status: 'open', priority: 'medium', labels: [], dueDate: null,
          milestoneExternalId: null, milestoneName: null, estimatedHours: null,
          blockedBy: [], createdAt: '2026-07-10T00:00:00.000Z',
        },
        {
          id: 'internal-b', projectId: 'p1', externalId: 'B', title: 'B', description: null,
          status: 'open', priority: 'medium', labels: [], dueDate: null,
          milestoneExternalId: null, milestoneName: null, estimatedHours: 1,
          blockedBy: ['internal-a'], createdAt: '2026-07-10T00:00:00.000Z',
        },
      ],
    });
    const app = createApp(config({ actio: { baseUrl: 'http://actio.test', token: null } }), { db });
    const response = await app.request('/api/plan/generate', { method: 'POST', body: '{}' });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      plan: { entries: unknown[] };
      warnings: { unestimated: string[]; messages: string[] };
    };
    expect(body.plan.entries).toEqual([]);
    expect(body.warnings.unestimated).toEqual([aRef]);
    expect(body.warnings.messages).toEqual(expect.arrayContaining([
      expect.stringContaining('excluded because an unestimated dependency'),
    ]));
  });});