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
    CREATE TABLE plan (id TEXT PRIMARY KEY, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL, status TEXT NOT NULL, velocity_snapshot TEXT NOT NULL, created_at TEXT NOT NULL, superseded_by TEXT);
    CREATE TABLE plan_entry (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, task_ref TEXT NOT NULL, start_at TEXT, end_at TEXT, lane TEXT NOT NULL, seq INTEGER NOT NULL, schedula_event_id TEXT, confidence REAL NOT NULL, is_human_gate INTEGER NOT NULL);
    CREATE TABLE sprint (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL, target_velocity REAL NOT NULL, gompertz_snapshot TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);
    CREATE TABLE curve_snapshot (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL, date TEXT NOT NULL, gompertz_params TEXT NOT NULL, inflow_lambda REAL NOT NULL, burndown_actual REAL NOT NULL, burndown_planned REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE confirmation (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decision_reason TEXT);
    CREATE TABLE goal_risk_snapshot (id TEXT PRIMARY KEY, goal_ref TEXT NOT NULL, date TEXT NOT NULL, projected_completion TEXT NOT NULL, deadline TEXT NOT NULL, level TEXT NOT NULL, factors TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(goal_ref, date));
  `);
  return drizzle(sqlite, { schema });
}

function config(nuntius = false): CalliopeConfig {
  return {
    port: 0, dbPath: ':memory:', agentLanes: 2, serviceToken: null, llmEstimation: false,
    actio: { baseUrl: null, token: null }, schedula: { baseUrl: null, token: null },
    memoria: { baseUrl: null, token: null }, concordiaBaseUrl: null,
    nuntiusBaseUrl: nuntius ? 'http://nuntius.test' : null,
    nuntiusToken: nuntius ? 'token' : null, claudeBin: 'claude',
  };
}

async function seed(db: CalliopeDb) {
  const repo = makeRepository(db);
  const now = new Date();
  await repo.createPlanWithEntries({
    id: 'active', periodStart: now.toISOString(), periodEnd: new Date(now.getTime() + 86400000).toISOString(),
    status: 'active', velocitySnapshot: {}, createdAt: now.toISOString(),
  }, [{
    id: 'entry', planId: 'active', taskRef: 'actio:1',
    startAt: new Date(now.getTime() - 60000).toISOString(), endAt: new Date(now.getTime() + 3600000).toISOString(),
    lane: 'human', seq: 0, confidence: 1, isHumanGate: true,
  }]);
  await repo.createConfirmation({
    id: 'confirmation', kind: 'reschedule', payload: {}, createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
  });
  await repo.upsertGoalRiskSnapshot({
    id: 'risk-old', goalRef: 'actio:g1', date: '2026-07-01', projectedCompletion: '2026-07-02',
    deadline: '2026-07-03', level: 'green', factors: {}, createdAt: now.toISOString(),
  });
  await repo.upsertGoalRiskSnapshot({
    id: 'risk-latest', goalRef: 'actio:g1', date: '2026-07-11', projectedCompletion: '2026-07-20',
    deadline: new Date(now.getTime() + 86400000).toISOString(), level: 'red', factors: {}, createdAt: now.toISOString(),
  });
}

describe('P3.5 daily briefing routes', () => {
  it('composes today and skips notification without returning 503 when Nuntius is unconfigured', async () => {
    const db = testDb();
    await seed(db);
    const app = createApp(config(), { db });
    const today = await app.request('/api/briefing/today');
    expect(today.status).toBe(200);
    await expect(today.json()).resolves.toMatchObject({
      planId: 'active', summary: { tasks: 1, decisions: 1, humanGates: 1 },
      alerts: [expect.objectContaining({ type: 'goal_risk', level: 'red' })],
    });
    const send = await app.request('/api/briefing/today/send', { method: 'POST' });
    expect(send.status).toBe(200);
    await expect(send.json()).resolves.toMatchObject({
      notification: { status: 'skipped', warning: 'nuntius_unconfigured_or_token_missing' },
    });
  });

  it('publishes through configured Nuntius and returns only delivery metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      topic: 'calliope.daily', delivered: 2,
      messages: [{ id: 'm1', userId: 'private-user', channel: 'discord' }],
    }));
    const db = testDb();
    await seed(db);
    const app = createApp(config(true), { db });
    const response = await app.request('/api/briefing/today/send', { method: 'POST' });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ notification: { status: 'sent', topic: 'calliope.daily', delivered: 2 } });
    expect(JSON.stringify(body)).not.toContain('private-user');
  });
});
