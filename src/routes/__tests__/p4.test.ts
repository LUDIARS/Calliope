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
    CREATE TABLE plan (id TEXT PRIMARY KEY, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL, status TEXT NOT NULL, velocity_snapshot TEXT NOT NULL, created_at TEXT NOT NULL, superseded_by TEXT);
    CREATE TABLE plan_entry (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plan(id), task_ref TEXT NOT NULL, start_at TEXT, end_at TEXT, lane TEXT NOT NULL, seq INTEGER NOT NULL, schedula_event_id TEXT, confidence REAL NOT NULL, is_human_gate INTEGER NOT NULL);
    CREATE TABLE reschedule_log (id TEXT PRIMARY KEY, trigger TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, applied_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, outcome TEXT NOT NULL, confirmation_id TEXT);
    CREATE TABLE confirmation (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decision_reason TEXT);
    CREATE TABLE calendar_link (id TEXT PRIMARY KEY, calendar_ref TEXT NOT NULL, sync_direction TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL);
  `);
  return drizzle(sqlite, { schema });
}

function config(overrides: Partial<CalliopeConfig> = {}): CalliopeConfig {
  return {
    port: 0, dbPath: ':memory:', agentLanes: 2, serviceToken: null, llmEstimation: false,
    calendarAutoWrite: false,
    actio: { baseUrl: null, token: null },
    schedula: { baseUrl: 'http://schedula.test', token: 'schedula-token' },
    memoria: { baseUrl: null, token: null }, concordiaBaseUrl: null,
    nuntiusBaseUrl: null, claudeBin: 'claude', ...overrides,
  };
}

async function seedActivePlan(db: CalliopeDb) {
  const repo = makeRepository(db);
  await repo.createPlanWithEntries({
    id: 'active', periodStart: '2026-07-13T00:00:00.000Z', periodEnd: '2026-07-14T00:00:00.000Z',
    status: 'active', velocitySnapshot: {}, createdAt: '2026-07-12T00:00:00.000Z',
  }, [{
    id: 'entry-1', planId: 'active', taskRef: 'actio:task-1',
    startAt: '2026-07-13T01:00:00.000Z', endAt: '2026-07-13T02:00:00.000Z',
    lane: 'ai-1', seq: 0, confidence: 1, isHumanGate: false,
  }]);
  return repo;
}

describe('P4 calendar binding', () => {
  it('requires confirmation, writes an opaque tagged block, and records the Schedula event id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      event: { id: 'google-event-1' },
    }));
    const db = testDb();
    const repo = await seedActivePlan(db);
    const app = createApp(config(), { db });
    const link = await app.request('/api/calendar/link', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calendarRef: 'primary', syncDirection: 'both', enabled: true }),
    });
    expect(link.status).toBe(200);
    const request = await app.request('/api/calendar/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(request.status).toBe(409);
    const proposal = await request.json() as { confirmationId: string };
    expect((await repo.getConfirmation(proposal.confirmationId))?.kind).toBe('calendar_write');

    const approval = await app.request(`/api/confirmations/${proposal.confirmationId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(approval.status).toBe(200);
    expect((await repo.getPlanEntries('active'))[0]?.schedulaEventId).toBe('google-event-1');
    expect((await repo.getConfirmation(proposal.confirmationId))?.status).toBe('approved');
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('http://schedula.test/api/calendar/events');
    expect(call?.[1]).toMatchObject({
      method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer schedula-token' }),
    });
    const sent = JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
    expect(sent.summary).toBe('Calliope: actio:task-1');
    expect(sent).toMatchObject({ extendedProperties: { private: {
      calliope: 'entry-1', calliopePlan: 'active',
    } } });
    expect(JSON.stringify(sent)).not.toContain('email');
  });

  it('reports an explicit skip when no calendar link is configured', async () => {
    const db = testDb();
    await seedActivePlan(db);
    const app = createApp(config({ calendarAutoWrite: true }), { db });
    const response = await app.request('/api/calendar/sync', { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'skipped', warning: 'calendar_link_unconfigured',
    });
  });

  it('reuses an old plan event when a task moves during supersede', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      event: { id: 'old-event' },
    }));
    const db = testDb();
    const repo = makeRepository(db);
    await repo.createPlanWithEntries({
      id: 'old', periodStart: '2026-07-13T00:00:00.000Z', periodEnd: '2026-07-14T00:00:00.000Z',
      status: 'active', velocitySnapshot: {}, createdAt: '2026-07-12T00:00:00.000Z',
    }, [{
      id: 'old-entry', planId: 'old', taskRef: 'actio:task-1',
      startAt: '2026-07-13T01:00:00.000Z', endAt: '2026-07-13T02:00:00.000Z',
      lane: 'ai-1', seq: 0, schedulaEventId: 'old-event', confidence: 1, isHumanGate: false,
    }]);
    await repo.createPlanWithEntries({
      id: 'new', periodStart: '2026-07-13T00:00:00.000Z', periodEnd: '2026-07-14T00:00:00.000Z',
      status: 'draft', velocitySnapshot: {}, createdAt: '2026-07-12T01:00:00.000Z',
    }, [{
      id: 'new-entry', planId: 'new', taskRef: 'actio:task-1',
      startAt: '2026-07-13T03:00:00.000Z', endAt: '2026-07-13T04:00:00.000Z',
      lane: 'ai-1', seq: 0, confidence: 1, isHumanGate: false,
    }]);
    await repo.applyPlan('new', {
      id: 'apply', trigger: 'test', appliedBy: 'human', reason: 'fixture',
      createdAt: '2026-07-12T02:00:00.000Z',
    });
    await repo.upsertCalendarLink({
      id: 'primary', calendarRef: 'primary', syncDirection: 'both', enabled: true,
      updatedAt: '2026-07-12T02:00:00.000Z',
    });
    const app = createApp(config({ calendarAutoWrite: true }), { db });
    const response = await app.request('/api/calendar/sync', { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'applied', result: { updated: 1, created: 0, deleted: 0 },
    });
    expect((await repo.getPlanEntries('new'))[0]?.schedulaEventId).toBe('old-event');
    expect((await repo.getPlanEntries('old'))[0]?.schedulaEventId).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://schedula.test/api/calendar/events/old-event');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH');
  });
});
