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
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE connector_state (service TEXT PRIMARY KEY, health TEXT NOT NULL, last_sync_at TEXT, cursor TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE velocity (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, category TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, k_factor REAL NOT NULL, throughput REAL NOT NULL, distribution TEXT NOT NULL, sample_size INTEGER NOT NULL, source TEXT NOT NULL);
    CREATE TABLE task_estimate (task_ref TEXT PRIMARY KEY, effort_minutes INTEGER NOT NULL, estimate_source TEXT NOT NULL, confidence REAL NOT NULL, estimated_at TEXT NOT NULL);
    CREATE TABLE priority (id TEXT PRIMARY KEY, scope TEXT NOT NULL, ref TEXT NOT NULL, resolved_score REAL NOT NULL, breakdown TEXT NOT NULL, first_ready_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE sprint (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL, target_velocity REAL NOT NULL, gompertz_snapshot TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);
    CREATE TABLE sprint_task (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL REFERENCES sprint(id) ON DELETE CASCADE, task_ref TEXT NOT NULL, effort_minutes INTEGER NOT NULL, priority_score REAL NOT NULL, status TEXT NOT NULL, status_history TEXT NOT NULL, committed_at TEXT NOT NULL, completed_at TEXT);
    CREATE UNIQUE INDEX uq_sprint_task ON sprint_task(sprint_id, task_ref);
    CREATE TABLE curve_snapshot (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL REFERENCES sprint(id) ON DELETE CASCADE, date TEXT NOT NULL, gompertz_params TEXT NOT NULL, inflow_lambda REAL NOT NULL, burndown_actual REAL NOT NULL, burndown_planned REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX uq_curve_snapshot_day ON curve_snapshot(sprint_id, date);
    CREATE TABLE goal_risk_snapshot (id TEXT PRIMARY KEY, goal_ref TEXT NOT NULL, date TEXT NOT NULL, projected_completion TEXT NOT NULL, deadline TEXT NOT NULL, level TEXT NOT NULL, factors TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX uq_goal_risk_snapshot_day ON goal_risk_snapshot(goal_ref, date);
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
    actio: { baseUrl: 'http://actio.test', token: null },
    schedula: { baseUrl: null, token: null },
    memoria: { baseUrl: null, token: null },
    concordiaBaseUrl: null,
    nuntiusBaseUrl: null,
    claudeBin: 'claude',
    ...overrides,
  };
}

function installActioFixture() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/tasks')) {
      return Response.json({ tasks: [{
        id: 'goal-1', title: 'Release', description: null, requirements: null, status: 'open',
        kind: 'goal', creatorType: 'human', category: 'Calliope', priority: 'high',
        deadline: '2020-01-01T00:00:00.000Z', estimatedMinutes: null, pluginId: null,
        pluginRef: null, completedAt: null, createdAt: '2026-07-01T00:00:00.000Z',
      }] });
    }
    if (url.endsWith('/api/pm/projects')) return Response.json({ projects: [{ id: 'p1', name: 'Calliope' }] });
    if (url.endsWith('/api/pm/projects/p1/tasks')) {
      return Response.json({ tasks: [{
        id: 'internal-1', projectId: 'p1', externalId: 'TASK-1', title: 'Implement', description: null,
        status: 'open', priority: 'high', labels: [], dueDate: null, milestoneExternalId: null,
        milestoneName: null, estimatedHours: 1, blockedBy: [], createdAt: '2026-07-01T00:00:00.000Z',
      }] });
    }
    if (url.endsWith('/api/pm/tasks/internal-1/history')) {
      return Response.json({ history: [{
        id: 'history-1', taskId: 'internal-1', changeType: 'created', changedFields: {}, snapshotData: {},
        detectedAt: '2026-07-01T00:00:00.000Z',
      }] });
    }
    if (url.endsWith('/api/pm/projects/p1/analytics/gompertz')) {
      return Response.json({
        projectId: 'p1', generatedAt: '2026-07-10T00:00:00.000Z', totalBugsFound: 0,
        totalBugsFixed: 0, estimatedTotalBugs: 0, convergenceDate: null, confidenceLevel: 0,
        dataPoints: [],
      });
    }
    if (url.endsWith('/api/pm/projects/p1/analytics/critical-path')) {
      return Response.json({
        path: [{ taskId: 'internal-1', title: 'Implement', estimatedDays: 10, assignee: '', status: 'open' }],
        totalEstimatedDays: 10, projectedCompletionDate: '2026-07-20', riskLevel: 'high',
      });
    }
    if (url.includes('/api/goal-evals')) {
      return Response.json([{
        id: 1, goal_id: 'goal-1', date: '2026-07-10', status: 'doing',
        evaluated_at: '2026-07-10 00:00:00', goal_title: 'Release',
      }]);
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
}

describe('P2 routes', () => {
  it('designs, activates, replans, records risk, and closes a sprint', async () => {
    installActioFixture();
    const db = testDb();
    const repo = makeRepository(db);
    const pmRef = makeTaskRef('actio-pm', 'p1', 'TASK-1');
    await repo.upsertTaskEstimate({
      taskRef: pmRef, effortMinutes: 60, estimateSource: 'human', confidence: 1,
      estimatedAt: '2026-07-10T00:00:00.000Z',
    });
    await repo.upsertPriority({
      scope: 'task', ref: pmRef, resolvedScore: 0.9, breakdown: {},
      firstReadyAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    });
    await repo.createVelocity({
      id: 'velocity-global', projectRef: '*', category: '*', windowStart: '2026-06-12T00:00:00.000Z',
      windowEnd: '2026-07-10T00:00:00.000Z', kFactor: 1, throughput: 120,
      distribution: { p25: 0.8, p50: 1, p75: 1.2 }, sampleSize: 10, source: 'fixture',
    });
    const app = createApp(config({ memoria: { baseUrl: 'http://memoria.test', token: null } }), { db });
    const createdResponse = await app.request('/api/sprint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectRef: 'p1', goalRef: makeTaskRef('actio', 'goal-1'), sprintDays: 14 }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { sprint: { id: string; tasks: unknown[]; curveSnapshots: unknown[] } };
    expect(created.sprint.tasks).toHaveLength(1);
    expect(created.sprint.curveSnapshots).toHaveLength(1);

    expect((await app.request(`/api/sprint/${created.sprint.id}/activate`, { method: 'POST' })).status).toBe(200);
    const competingResponse = await app.request('/api/sprint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectRef: 'p1', goalRef: makeTaskRef('actio', 'goal-1'), sprintDays: 14 }),
    });
    const competing = await competingResponse.json() as { sprint: { id: string } };
    expect((await app.request(`/api/sprint/${competing.sprint.id}/activate`, { method: 'POST' })).status).toBe(409);

    const replanResponse = await app.request(`/api/sprint/${created.sprint.id}/replan`, { method: 'POST' });
    expect(replanResponse.status).toBe(200);
    const replanned = await replanResponse.json() as {
      health: { goalProgress: { source: string } };
      risk: { snapshots: Array<{ level: string; notificationRequired: boolean }> };
    };
    expect(replanned.health.goalProgress.source).toBe('memoria_goal_eval');
    expect(replanned.risk.snapshots[0]).toMatchObject({ level: 'red', notificationRequired: true });

    const repeatedRisk = await app.request('/api/risk/refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sprintId: created.sprint.id }),
    });
    const repeated = await repeatedRisk.json() as { snapshots: Array<{ notificationRequired: boolean }> };
    expect(repeated.snapshots[0]?.notificationRequired).toBe(false);
    const riskListResponse = await app.request('/api/risk?level=red');
    expect(riskListResponse.status).toBe(200);
    const riskList = await riskListResponse.json() as { snapshots: unknown[] };
    expect(riskList.snapshots).toHaveLength(1);
    const sprintDetail = await (await app.request(`/api/sprint/${created.sprint.id}`)).json() as {
      sprint: { curveSnapshots: unknown[] };
    };
    expect(sprintDetail.sprint.curveSnapshots).toHaveLength(1);

    const closeResponse = await app.request(`/api/sprint/${created.sprint.id}/close`, { method: 'POST' });
    expect(closeResponse.status).toBe(200);
    const closed = await closeResponse.json() as {
      sprint: { status: string };
      carryover: string[];
      nextSprint: { sprint: { status: string } };
    };
    expect(closed.sprint.status).toBe('closed');
    expect(closed.carryover).toEqual([pmRef]);
    expect(closed.nextSprint.sprint.status).toBe('planned');
  });

  it('rejects sprint design when P1 velocity is missing', async () => {
    installActioFixture();
    const db = testDb();
    const repo = makeRepository(db);
    const pmRef = makeTaskRef('actio-pm', 'p1', 'TASK-1');
    await repo.upsertPriority({
      scope: 'task', ref: pmRef, resolvedScore: 1, breakdown: {}, updatedAt: '2026-07-10T00:00:00.000Z',
    });
    const app = createApp(config(), { db });
    const response = await app.request('/api/sprint', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectRef: 'p1' }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'sprint_prerequisites_missing', missing: expect.arrayContaining(['velocity']),
    });
  });
});
