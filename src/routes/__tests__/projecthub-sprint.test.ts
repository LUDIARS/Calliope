import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.ts';
import type { CalliopeConfig } from '../../config.ts';
import type { CalliopeDb } from '../../db/client.ts';
import { makeRepository } from '../../db/repository.ts';
import * as schema from '../../db/schema.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY_MS).toISOString();

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
    projecthub: { baseUrl: 'http://projecthub.test', token: null, serviceToken: 'projecthub-secret' },
    concordiaBaseUrl: null,
    nuntiusBaseUrl: null,
    claudeBin: 'claude',
    ...overrides,
  };
}

function installFixture() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/tasks')) {
      return Response.json({ tasks: [
        {
          id: 'task-open', title: 'Implement title screen', description: null, requirements: null,
          status: 'open', kind: 'task', creatorType: 'human', category: null, priority: 'high',
          deadline: null, estimatedMinutes: 60, pluginId: null, pluginRef: null, projectId: 'p1',
          completedAt: null, createdAt: daysAgo(90),
        },
        {
          id: 'task-done', title: 'Prototype movement', description: null, requirements: null,
          status: 'done', kind: 'task', creatorType: 'human', category: null, priority: 'medium',
          deadline: null, estimatedMinutes: 140, pluginId: null, pluginRef: null, projectId: 'p1',
          completedAt: daysAgo(7), createdAt: daysAgo(90),
        },
      ] });
    }
    if (url.endsWith('/api/pm/projects')) {
      // loadPlanningTasks() always calls Actio PM projects too (scope-agnostic unification);
      // this projecthub-linked project has no Actio PM projects registered.
      return Response.json({ projects: [] });
    }
    if (url.endsWith('/api/x/projects/external/projects/p1')) {
      return Response.json({ project: {
        id: 'p1', name: 'Demo Game', description: null, status: 'active', repoUrl: null,
        createdAt: Date.now() - 200 * DAY_MS, updatedAt: Date.now(),
        members: [{ userId: 'u1', role: 'producer', displayName: 'Producer One', createdAt: Date.now() }],
      } });
    }
    if (url.endsWith('/api/x/projects/external/projects')) {
      return Response.json({ projects: [{
        id: 'p1', name: 'Demo Game', description: null, status: 'active', repoUrl: null,
        createdAt: Date.now() - 200 * DAY_MS, updatedAt: Date.now(), members: [],
      }] });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
}

describe('PROJECTHUB scope sprint routes (docs/design/projecthub-pm.md H4)', () => {
  it('designs, activates, replans (degraded gompertz), and closes a projecthub:<project_id> sprint', async () => {
    installFixture();
    const db = testDb();
    const repo = makeRepository(db);
    await repo.upsertPriority({
      scope: 'task', ref: 'actio:task-open', resolvedScore: 0.9, breakdown: {},
      firstReadyAt: daysAgo(1), updatedAt: daysAgo(1),
    });
    const app = createApp(config(), { db });

    const createdResponse = await app.request('/api/sprint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectRef: 'projecthub:p1', sprintDays: 14 }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as {
      sprint: { id: string; projectRef: string; tasks: Array<{ taskRef: string }> };
      warnings: string[];
    };
    expect(created.sprint.projectRef).toBe('projecthub:p1');
    expect(created.sprint.tasks.map((task) => task.taskRef)).toEqual(['actio:task-open']);
    expect(created.warnings).toContain(
      'gompertz_degraded: projecthub scope has no bug curve data; bug reserve is zero (inflow-reservation-only mode)',
    );

    const activateResponse = await app.request(`/api/sprint/${created.sprint.id}/activate`, { method: 'POST' });
    expect(activateResponse.status).toBe(200);

    const replanResponse = await app.request(`/api/sprint/${created.sprint.id}/replan`, { method: 'POST' });
    expect(replanResponse.status).toBe(200);
    const replanned = await replanResponse.json() as {
      health: { status: string; gompertzConfidence: number };
      risk: { snapshots: unknown[]; skipped: Array<{ sprintId: string; reason: string }> };
    };
    expect(replanned.health.gompertzConfidence).toBe(0);

    // H4: PROJECTHUB scope has no Actio PM critical-path source, so the generic goal-risk engine
    // must explicitly skip it rather than silently fall back or crash.
    expect(replanned.risk.skipped).toEqual([
      expect.objectContaining({ sprintId: created.sprint.id, reason: 'projecthub_scope_unsupported_for_goal_risk' }),
    ]);
    expect(replanned.risk.snapshots).toHaveLength(0);

    const progressResponse = await app.request('/api/projecthub/progress?project_id=p1');
    expect(progressResponse.status).toBe(200);
    const progress = await progressResponse.json() as {
      projects: Array<{ projectId: string; health: { status: string }; burndown: { committedMinutes: number } | null }>;
    };
    expect(progress.projects).toHaveLength(1);
    expect(progress.projects[0]?.projectId).toBe('p1');
    expect(progress.projects[0]?.burndown?.committedMinutes).toBe(60);

    const closeResponse = await app.request(`/api/sprint/${created.sprint.id}/close`, { method: 'POST' });
    expect(closeResponse.status).toBe(200);
    const closed = await closeResponse.json() as { sprint: { status: string }; nextSprint: { sprint: { projectRef: string } } };
    expect(closed.sprint.status).toBe('closed');
    expect(closed.nextSprint.sprint.projectRef).toBe('projecthub:p1');
  });

  it('returns projecthub_unconfigured (503) instead of falling back to Actio PM lookup', async () => {
    installFixture();
    const db = testDb();
    const app = createApp(config({ projecthub: { baseUrl: null, token: null, serviceToken: null } }), { db });
    const response = await app.request('/api/sprint', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectRef: 'projecthub:p1' }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'projecthub_unconfigured' });
  });

  it('reports a no_sprint progress entry for a projecthub project with no sprint yet', async () => {
    installFixture();
    const db = testDb();
    const app = createApp(config(), { db });
    const response = await app.request('/api/projecthub/progress?project_id=p1');
    expect(response.status).toBe(200);
    const body = await response.json() as { projects: Array<{ health: { status: string } }> };
    expect(body.projects[0]?.health.status).toBe('no_sprint');
  });
});
