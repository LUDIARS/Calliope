import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.ts';
import type { CalliopeConfig } from '../../config.ts';
import type { CalliopeDb } from '../../db/client.ts';
import { makeRepository } from '../../db/repository.ts';
import * as schema from '../../db/schema.ts';
import { makeTaskRef } from '../../refs.ts';

const databases: Database.Database[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});

function testDb(): CalliopeDb {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE connector_state (service TEXT PRIMARY KEY, health TEXT NOT NULL, last_sync_at TEXT, cursor TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE plan (id TEXT PRIMARY KEY, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL, status TEXT NOT NULL, velocity_snapshot TEXT NOT NULL, created_at TEXT NOT NULL, superseded_by TEXT);
    CREATE TABLE plan_entry (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plan(id) ON DELETE CASCADE, task_ref TEXT NOT NULL, start_at TEXT, end_at TEXT, lane TEXT NOT NULL, seq INTEGER NOT NULL, schedula_event_id TEXT, confidence REAL NOT NULL, is_human_gate INTEGER NOT NULL);
    CREATE TABLE velocity (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, category TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, k_factor REAL NOT NULL, throughput REAL NOT NULL, distribution TEXT NOT NULL, sample_size INTEGER NOT NULL, source TEXT NOT NULL);
    CREATE TABLE task_estimate (task_ref TEXT PRIMARY KEY, effort_minutes INTEGER NOT NULL, estimate_source TEXT NOT NULL, confidence REAL NOT NULL, estimated_at TEXT NOT NULL);
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
    schedula: { baseUrl: null, token: null }, memoria: { baseUrl: null, token: null },
    concordiaBaseUrl: null, nuntiusBaseUrl: null, claudeBin: 'claude',
  };
}

function mockActio(kind: 'task' | 'goal') {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/tasks')) return Response.json({ tasks: [{
      id: '1', title: kind === 'goal' ? 'Approval' : 'Implement', description: null, requirements: null,
      status: 'open', kind, creatorType: kind === 'goal' ? 'human' : 'ai', category: 'p1', priority: 'high',
      deadline: null, estimatedMinutes: 60, pluginId: null, pluginRef: null, completedAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    }] });
    if (url.endsWith('/api/pm/projects')) return Response.json({ projects: [] });
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
}

async function seed(db: CalliopeDb, kind: 'task' | 'goal') {
  const repo = makeRepository(db);
  const now = new Date();
  const ref = makeTaskRef('actio', '1');
  await repo.upsertTaskEstimate({ taskRef: ref, effortMinutes: 60, estimateSource: 'human', confidence: 1, estimatedAt: now.toISOString() });
  await repo.upsertPriority({ scope: kind === 'goal' ? 'goal' : 'task', ref, resolvedScore: 0.8, breakdown: {}, firstReadyAt: now.toISOString(), updatedAt: now.toISOString() });
  await repo.createVelocity({ id: 'v', projectRef: '*', category: '*', windowStart: new Date(now.getTime() - 86400000).toISOString(), windowEnd: now.toISOString(), kFactor: 1, throughput: 60, distribution: { p25: 1, p50: 1, p75: 1 }, sampleSize: 10, source: 'fixture' });
  await repo.createPlanWithEntries({
    id: 'active', periodStart: now.toISOString(), periodEnd: new Date(now.getTime() + 86400000 * 30).toISOString(),
    status: 'active', velocitySnapshot: [], createdAt: now.toISOString(),
  }, [{
    id: 'active-entry', planId: 'active', taskRef: ref,
    startAt: new Date(now.getTime() + 86400000).toISOString(), endAt: new Date(now.getTime() + 86400000 + 3600000).toISOString(),
    lane: kind === 'goal' ? 'human' : 'ai-1', seq: 0, confidence: 1, isHumanGate: kind === 'goal',
  }]);
  return { repo, ref };
}

describe('P3 autonomy routes', () => {
  it('auto-applies low-risk changes and keeps What-if simulation write-free', async () => {
    mockActio('task');
    const db = testDb();
    const { repo } = await seed(db, 'task');
    const app = createApp(config(), { db });
    const beforeCount = (await repo.listPlans()).length;
    const simulation = await app.request('/api/plan/simulate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changes: { lanes: 1 } }),
    });
    expect(simulation.status).toBe(200);
    expect((await repo.listPlans()).length).toBe(beforeCount);
    const response = await app.request('/api/reschedule/trigger', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger: 'manual', projectRef: 'p1', refresh: false }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ outcome: 'applied', risk: { level: 'low' } });
    expect((await repo.listPlans('active'))[0]?.id).not.toBe('active');
  });

  it('queues high-risk human-gate changes and applies them only after approval', async () => {
    mockActio('goal');
    const db = testDb();
    const { repo } = await seed(db, 'goal');
    const app = createApp(config(), { db });
    const response = await app.request('/api/reschedule/trigger', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trigger: 'manual', refresh: false }),
    });
    expect(response.status).toBe(409);
    const proposal = await response.json() as { confirmationId: string; risk: { level: string } };
    expect(proposal.risk.level).toBe('high');
    expect((await repo.listPlans('active'))[0]?.id).toBe('active');
    const approval = await app.request(`/api/confirmations/${proposal.confirmationId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
    });
    expect(approval.status).toBe(200);
    expect((await repo.getConfirmation(proposal.confirmationId))?.status).toBe('approved');
    expect((await repo.listPlans('active'))[0]?.id).not.toBe('active');
    expect((await repo.listRescheduleLogs()).every((log) => log.outcome === 'applied')).toBe(true);
  });

  it('requires a reason when rejecting a confirmation', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    const now = new Date();
    await repo.createConfirmation({
      id: 'c1', kind: 'reschedule', payload: { beforePlanId: 'a', afterPlanId: 'b' },
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString(),
    });
    const app = createApp(config(), { db });
    const response = await app.request('/api/confirmations/c1', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'reject' }),
    });
    expect(response.status).toBe(400);
    const rejected = await app.request('/api/confirmations/c1', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'reject', reason: 'keep current plan' }),
    });
    expect(rejected.status).toBe(200);
    expect((await repo.getConfirmation('c1'))?.status).toBe('rejected');

    await repo.createConfirmation({
      id: 'expired', kind: 'reschedule', payload: { beforePlanId: 'a', afterPlanId: 'b' },
      createdAt: new Date(now.getTime() - 7200000).toISOString(),
      expiresAt: new Date(now.getTime() - 3600000).toISOString(),
    });
    const expiredList = await app.request('/api/confirmations?status=expired');
    expect(expiredList.status).toBe(200);
    expect((await repo.getConfirmation('expired'))?.status).toBe('expired');
  });

  it('expires a stale confirmation and re-proposes instead of applying the old diff', async () => {
    mockActio('goal');
    const db = testDb();
    const { repo, ref } = await seed(db, 'goal');
    const app = createApp(config(), { db });
    const proposalResponse = await app.request('/api/reschedule/trigger', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger: 'manual', refresh: false }),
    });
    const proposal = await proposalResponse.json() as { confirmationId: string };
    const now = new Date();
    await repo.createPlanWithEntries({
      id: 'newer', periodStart: now.toISOString(), periodEnd: new Date(now.getTime() + 86400000).toISOString(),
      status: 'draft', velocitySnapshot: [], createdAt: now.toISOString(),
    }, [{
      id: 'newer-entry', planId: 'newer', taskRef: ref,
      startAt: new Date(now.getTime() + 7200000).toISOString(), endAt: new Date(now.getTime() + 10800000).toISOString(),
      lane: 'human', seq: 0, confidence: 1, isHumanGate: true,
    }]);
    await repo.applyPlan('newer', {
      id: 'external-apply', trigger: 'test_state_change', appliedBy: 'human',
      reason: 'fixture state changed', createdAt: now.toISOString(),
    });
    const approval = await app.request(`/api/confirmations/${proposal.confirmationId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
    });
    expect(approval.status).toBe(409);
    await expect(approval.json()).resolves.toMatchObject({ error: 'confirmation_stale' });
    expect((await repo.getConfirmation(proposal.confirmationId))?.status).toBe('expired');
    expect((await repo.listPlans('active'))[0]?.id).toBe('newer');
  });
});
