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
    CREATE TABLE priority (id TEXT PRIMARY KEY, scope TEXT NOT NULL, ref TEXT NOT NULL, resolved_score REAL NOT NULL, breakdown TEXT NOT NULL, first_ready_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE reschedule_log (id TEXT PRIMARY KEY, trigger TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, applied_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'applied', confirmation_id TEXT);
    CREATE TABLE confirmation (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decision_reason TEXT);
  `);
  return drizzle(sqlite, { schema });
}

function config(): CalliopeConfig {
  return {
    port: 0, dbPath: ':memory:', agentLanes: 2, serviceToken: null, llmEstimation: false,
    actio: { baseUrl: 'http://actio.test', token: null },
    schedula: { baseUrl: null, token: null },
    memoria: { baseUrl: 'http://memoria.test', token: null },
    concordiaBaseUrl: null, nuntiusBaseUrl: null, claudeBin: 'claude',
  };
}

function actioTask(overrides: Record<string, unknown> & { id: string }) {
  return {
    title: `Task ${overrides.id}`, description: null, requirements: null,
    status: 'open', kind: 'task', creatorType: 'ai', category: 'p1', priority: 'medium',
    deadline: null, estimatedMinutes: null, pluginId: null, pluginRef: null, projectId: null,
    completedAt: null, createdAt: '2026-07-01T00:00:00.000Z', ...overrides,
  };
}

const TASKS = [
  actioTask({ id: '1', title: 'Old low task', priority: 'low', category: 'p1' }),
  actioTask({ id: '2', title: 'Finished work', priority: 'medium', category: 'p2' }),
  actioTask({ id: '3', title: 'Duplicate item', category: 'p3' }),
  actioTask({ id: '4', title: 'duplicate  item', category: 'p3' }),
  actioTask({ id: '5', title: 'Cancelled thing', status: 'cancelled', category: 'p4' }),
];

const AGENT_RUNS = {
  items: [{
    id: 'run-1', task_id: '2', project_id: null, status: 'done',
    started_at: '2026-07-10T00:00:00.000Z', finished_at: '2026-07-10T01:00:00.000Z',
  }],
};

function mockUpstreams() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/api/agent-runs')) return Response.json(AGENT_RUNS);
    if (url.includes('/api/tasks/')) {
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ task: { ...actioTask({ id: url.split('/').pop() ?? '0' }), ...patch } });
    }
    if (url.endsWith('/api/tasks') && method === 'GET') return Response.json({ tasks: TASKS });
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
}

async function seedResolvedPriority(db: CalliopeDb) {
  const repo = makeRepository(db);
  await repo.upsertPriority({
    scope: 'task', ref: 'actio:1', resolvedScore: 0.95, breakdown: {},
    updatedAt: '2026-07-20T00:00:00.000Z',
  });
  return repo;
}

describe('task stocktake routes', () => {
  it('GET synthesizes a report on demand without persisting it', async () => {
    mockUpstreams();
    const db = testDb();
    await seedResolvedPriority(db);
    const app = createApp(config(), { db });

    const response = await app.request('/api/tasks/stocktake');
    expect(response.status).toBe(200);
    const report = await response.json() as { summary: Record<string, number>; proposals: unknown[] };
    // done(task2) + duplicate([3,4]) + priorityStaleness(task1) → cancelled task5 excluded.
    expect(report.summary).toMatchObject({
      doneCandidates: 1, duplicateCandidates: 1, priorityStaleness: 1, proposals: 3,
    });
    // GET must not persist any confirmation.
    expect(await makeRepository(db).listConfirmations()).toHaveLength(0);
  });

  it('POST pushes a task_stocktake confirmation; approve executes close + reprioritize, skips merge', async () => {
    const fetchMock = mockUpstreams();
    const db = testDb();
    const repo = await seedResolvedPriority(db);
    const app = createApp(config(), { db });

    const run = await app.request('/api/tasks/stocktake', { method: 'POST' });
    expect(run.status).toBe(200);
    const { confirmation } = await run.json() as { confirmation: { id: string; kind: string } };
    expect(confirmation.kind).toBe('task_stocktake');
    expect((await repo.getConfirmation(confirmation.id))?.status).toBe('pending');

    const approval = await app.request(`/api/confirmations/${confirmation.id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(approval.status).toBe(200);
    const body = await approval.json() as { result: { outcomes: Array<Record<string, unknown>> } };
    expect(body.result.outcomes).toEqual(expect.arrayContaining([
      { action: 'close', taskId: '2', status: 'applied' },
      { action: 'reprioritize', taskId: '1', status: 'applied' },
      { action: 'merge', taskIds: ['3', '4'], status: 'skipped', detail: 'merge is proposal-only; no execution' },
    ]));
    expect((await repo.getConfirmation(confirmation.id))?.status).toBe('approved');

    const patches = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([url, init]) => [String(url), init?.body]);
    expect(patches).toEqual([
      ['http://actio.test/api/tasks/2', JSON.stringify({ status: 'done' })],
      ['http://actio.test/api/tasks/1', JSON.stringify({ priority: 'critical' })],
    ]);
  });

  it('rejecting a task_stocktake confirmation requires a reason', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    const now = new Date();
    await repo.createConfirmation({
      id: 'st1', kind: 'task_stocktake',
      payload: { generatedAt: now.toISOString(), summary: {
        aging: 0, doneCandidates: 1, duplicateCandidates: 0, priorityStaleness: 0, proposals: 1,
      }, proposals: [{ action: 'close', taskId: '9', title: 'x', reason: 'done_candidate' }] },
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString(),
    });
    const app = createApp(config(), { db });

    const missing = await app.request('/api/confirmations/st1', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'reject' }),
    });
    expect(missing.status).toBe(400);

    const rejected = await app.request('/api/confirmations/st1', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'reject', reason: 'tasks are still active' }),
    });
    expect(rejected.status).toBe(200);
    expect((await repo.getConfirmation('st1'))?.status).toBe('rejected');
  });

  it('returns 503 memoria_unconfigured when Memoria is not set (no silent fallback)', async () => {
    const db = testDb();
    const app = createApp({ ...config(), memoria: { baseUrl: null, token: null } }, { db });
    const response = await app.request('/api/tasks/stocktake');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'memoria_unconfigured' });
  });
});
