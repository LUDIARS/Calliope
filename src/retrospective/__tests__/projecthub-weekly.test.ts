import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { CalliopeClients } from '../../clients/index.ts';
import type { CalliopeDb } from '../../db/client.ts';
import { makeRepository } from '../../db/repository.ts';
import * as schema from '../../db/schema.ts';
import { makeProjectHubWeeklyEngine } from '../projecthub-weekly.ts';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function testDb(): CalliopeDb {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE velocity (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, category TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, k_factor REAL NOT NULL, throughput REAL NOT NULL, distribution TEXT NOT NULL, sample_size INTEGER NOT NULL, source TEXT NOT NULL);
    CREATE TABLE sprint (id TEXT PRIMARY KEY, project_ref TEXT NOT NULL, goal_ref TEXT, period_start TEXT NOT NULL, period_end TEXT NOT NULL, target_velocity REAL NOT NULL, gompertz_snapshot TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);
    CREATE TABLE sprint_task (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL REFERENCES sprint(id) ON DELETE CASCADE, task_ref TEXT NOT NULL, effort_minutes INTEGER NOT NULL, priority_score REAL NOT NULL, status TEXT NOT NULL, status_history TEXT NOT NULL, committed_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE curve_snapshot (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL REFERENCES sprint(id) ON DELETE CASCADE, date TEXT NOT NULL, gompertz_params TEXT NOT NULL, inflow_lambda REAL NOT NULL, burndown_actual REAL NOT NULL, burndown_planned REAL NOT NULL, created_at TEXT NOT NULL);
  `);
  return drizzle(sqlite, { schema });
}

function fakeClients(overrides: Partial<CalliopeClients> = {}): CalliopeClients {
  return {
    actio: null,
    schedula: null,
    memoria: null,
    nuntius: null,
    projecthub: null,
    ...overrides,
  } as CalliopeClients;
}

describe('PROJECTHUB weekly report delivery (docs/design/projecthub-pm.md H4, calliope.projecthub.weekly)', () => {
  it('explicitly skips delivery when Nuntius is unconfigured (no silent drop)', async () => {
    const repo = makeRepository(testDb());
    const clients = fakeClients({
      projecthub: { listProjects: async () => [] } as unknown as CalliopeClients['projecthub'],
      actio: { listTasks: async () => [] } as unknown as CalliopeClients['actio'],
    });
    const engine = makeProjectHubWeeklyEngine({ clients, repo });
    const result = await engine.sendWeekly();
    expect(result.notification).toEqual({ status: 'skipped', warning: 'nuntius_unconfigured_or_token_missing' });
    expect(result.report?.projects).toEqual([]);
  });

  it('explicitly skips (not silently) when PROJECTHUB itself is unconfigured', async () => {
    const repo = makeRepository(testDb());
    const engine = makeProjectHubWeeklyEngine({ clients: fakeClients(), repo });
    const result = await engine.sendWeekly();
    expect(result.report).toBeNull();
    expect(result.notification.status).toBe('skipped');
    expect(result.notification.warning).toContain('projecthub_prerequisites_missing');
  });

  it('publishes to the calliope.projecthub.weekly topic once PROJECTHUB, Actio, and Nuntius are all configured', async () => {
    const repo = makeRepository(testDb());
    let publishedTopic: string | null = null;
    const clients = fakeClients({
      projecthub: {
        listProjects: async () => [{
          id: 'p1', name: 'Demo Game', description: null, status: 'active', repoUrl: null,
          createdAt: 0, updatedAt: 0, members: [],
        }],
        getProject: async () => { throw new Error('not used in this test'); },
        listMembers: async () => [],
        health: async () => ({}),
      } as unknown as CalliopeClients['projecthub'],
      actio: { listTasks: async () => [] } as unknown as CalliopeClients['actio'],
      nuntius: {
        publishProjectHubWeeklyReport: async (report: unknown) => {
          publishedTopic = 'calliope.projecthub.weekly';
          return { topic: 'calliope.projecthub.weekly', delivered: 1, messages: [] };
        },
      } as unknown as CalliopeClients['nuntius'],
    });
    const engine = makeProjectHubWeeklyEngine({ clients, repo });
    const result = await engine.sendWeekly();
    expect(publishedTopic).toBe('calliope.projecthub.weekly');
    expect(result.notification).toMatchObject({ status: 'sent', topic: 'calliope.projecthub.weekly', delivered: 1 });
    expect(result.report?.projects[0]?.health.status).toBe('no_sprint');
  });
});
