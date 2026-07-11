import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.ts';
import type { CalliopeConfig } from '../../config.ts';
import type { CalliopeDb } from '../../db/client.ts';
import { makeRepository } from '../../db/repository.ts';
import * as schema from '../../db/schema.ts';
import { dashboardScript } from '../../ui/script.ts';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function testDb(): CalliopeDb {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE velocity (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, category TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, k_factor REAL NOT NULL, throughput REAL NOT NULL, distribution TEXT NOT NULL, sample_size INTEGER NOT NULL, source TEXT NOT NULL);
    CREATE TABLE sprint (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL, target_velocity REAL NOT NULL, gompertz_snapshot TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);
    CREATE TABLE curve_snapshot (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL, date TEXT NOT NULL, gompertz_params TEXT NOT NULL, inflow_lambda REAL NOT NULL, burndown_actual REAL NOT NULL, burndown_planned REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE priority (id TEXT PRIMARY KEY, scope TEXT NOT NULL, ref TEXT NOT NULL, resolved_score REAL NOT NULL, breakdown TEXT NOT NULL, first_ready_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE reschedule_log (id TEXT PRIMARY KEY, trigger TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, applied_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, outcome TEXT NOT NULL, confirmation_id TEXT);
  `);
  return drizzle(sqlite, { schema });
}

function config(): CalliopeConfig {
  return {
    port: 0, dbPath: ':memory:', agentLanes: 3, serviceToken: null, llmEstimation: false,
    actio: { baseUrl: null, token: null }, schedula: { baseUrl: null, token: null },
    memoria: { baseUrl: null, token: null }, concordiaBaseUrl: null,
    nuntiusBaseUrl: null, claudeBin: 'claude',
  };
}

describe('P5 dashboard and retrospective', () => {
  it('serves a CSP-protected dashboard and static assets', async () => {
    expect(() => new Function(dashboardScript)).not.toThrow();
    const app = createApp(config(), { db: testDb() });
    const page = await app.request('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await page.text()).toContain('Calliope Command Deck');
    expect((await app.request('/assets/calliope.js')).headers.get('content-type')).toContain('text/javascript');
  });

  it('composes F7 on demand and explicitly skips an unconfigured Nuntius', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    await repo.createVelocity({
      id: 'v1', projectRef: 'p1', category: '*', windowStart: '2026-07-01', windowEnd: '2026-07-10',
      kFactor: 1, throughput: 60, distribution: { accuracyBySource: {} }, sampleSize: 4, source: 'fixture',
    });
    await repo.upsertPriority({
      scope: 'task', ref: 'actio:1', resolvedScore: 0.5, breakdown: { aging: 0.5 },
      firstReadyAt: '2026-07-01T00:00:00.000Z', updatedAt: new Date().toISOString(),
    });
    const app = createApp(config(), { db });
    const weekly = await app.request('/api/retrospective/weekly');
    expect(weekly.status).toBe(200);
    await expect(weekly.json()).resolves.toMatchObject({ starvation: [{ ref: 'actio:1', aging: 0.5 }] });
    const send = await app.request('/api/retrospective/weekly/send', { method: 'POST' });
    expect(send.status).toBe(200);
    await expect(send.json()).resolves.toMatchObject({
      notification: { status: 'skipped', warning: 'nuntius_unconfigured_or_token_missing' },
    });
  });
});
