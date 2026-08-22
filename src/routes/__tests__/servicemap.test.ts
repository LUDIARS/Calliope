import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.ts';
import { makeClients, type CalliopeClients } from '../../clients/index.ts';
import type { CalliopeConfig } from '../../config.ts';
import type { CalliopeDb } from '../../db/client.ts';
import { makeRepository } from '../../db/repository.ts';
import * as schema from '../../db/schema.ts';
import { UNGROUPED_ID } from '../../servicemap/sync.ts';

const ADMIN_TOKEN = 'service-map-test-token';
const NOW = '2026-08-13T12:00:00.000Z';
const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const sqlite of openDatabases.splice(0)) sqlite.close();
});

function testDb(): CalliopeDb {
  const sqlite = new Database(':memory:');
  openDatabases.push(sqlite);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE connector_state (service TEXT PRIMARY KEY, health TEXT NOT NULL, last_sync_at TEXT, cursor TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE service_map_domain (id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE service_map_group (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain_id TEXT REFERENCES service_map_domain(id) ON DELETE SET NULL, updated_at TEXT NOT NULL);
    CREATE TABLE service_map_pc (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT '手動稼働', priority TEXT NOT NULL DEFAULT 'A', os TEXT NOT NULL DEFAULT '', cpu TEXT NOT NULL DEFAULT '', ram TEXT NOT NULL DEFAULT '', gpu TEXT NOT NULL DEFAULT '', storage TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE service_map_service (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, project_code TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'saas', port INTEGER, description TEXT NOT NULL DEFAULT '', cadence TEXT NOT NULL DEFAULT '常時', load TEXT NOT NULL DEFAULT 'medium', group_ids TEXT NOT NULL, pc_ids TEXT NOT NULL, run_state TEXT NOT NULL DEFAULT 'unknown', in_catalog INTEGER NOT NULL DEFAULT 1, manual INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE service_map_roadmap (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', payload TEXT NOT NULL, generated_at TEXT NOT NULL, superseded_by TEXT);
  `);
  return drizzle(sqlite, { schema });
}

function config(): CalliopeConfig {
  return {
    port: 0,
    dbPath: ':memory:',
    agentLanes: 1,
    serviceToken: null,
    serviceMapAdminToken: ADMIN_TOKEN,
    llmEstimation: false,
    actio: { baseUrl: null, token: null },
    schedula: { baseUrl: null, token: null },
    memoria: { baseUrl: null, token: null },
    excubitor: { baseUrl: null, token: null },
    concordiaBaseUrl: null,
    nuntiusBaseUrl: null,
    claudeBin: 'claude',
  };
}

function adminRequest(body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

describe('service-map admin integrity', () => {
  it('allows Villa state only once so a repeated upload cannot overwrite newer assignments', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    const app = createApp(config(), { db });
    const villaState = {
      pcs: [{ id: 'pc-old', name: 'Old PC' }],
      groups: [{ id: 'group-a', name: 'Group A' }],
      workloads: [{ id: 'svc-a', name: 'A', groupIds: ['group-a'], pcIds: ['pc-old'] }],
    };

    expect((await app.request('/service-map/admin/api/import/villa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(villaState),
    })).status).toBe(401);
    expect((await app.request('/service-map/api/admin/import/villa', adminRequest(villaState))).status).toBe(404);
    expect((await app.request('/service-map/admin/api/import/villa', adminRequest(villaState))).status).toBe(200);
    expect((await app.request('/service-map/admin/api/overview')).status).toBe(401);
    expect((await app.request('/service-map/admin/api/overview', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(200);
    expect((await app.request('/service-map/admin/api/domains', adminRequest({
      id: 'domain-current', name: 'Current', note: '', seq: 0,
    }))).status).toBe(200);
    expect((await app.request('/service-map/admin/api/groups', adminRequest({
      id: 'group-a', name: 'Group A', domainId: 'domain-current',
    }))).status).toBe(200);
    expect((await app.request('/service-map/admin/api/pcs', adminRequest({
      id: 'pc-current', name: 'Current PC',
    }))).status).toBe(200);
    expect((await app.request('/service-map/admin/api/services/svc-a', {
      ...adminRequest({ groupIds: ['group-a'], pcIds: ['pc-current'] }),
      method: 'PATCH',
    })).status).toBe(200);

    expect((await app.request('/service-map/admin/api/import/villa', adminRequest(villaState))).status).toBe(409);
    expect((await repo.listGroups()).find((group) => group.id === 'group-a')?.domainId).toBe('domain-current');
    expect((await repo.getService('svc-a'))?.pcIds).toEqual(['pc-current']);
  });

  it('serializes concurrent Villa imports so exactly one request can claim the migration', async () => {
    const db = testDb();
    const app = createApp(config(), { db });
    const villaState = {
      pcs: [{ id: 'pc-a', name: 'A' }],
      groups: [{ id: 'group-a', name: 'A' }],
      workloads: [{ id: 'svc-a', name: 'A', groupIds: ['group-a'], pcIds: ['pc-a'] }],
    };

    const responses = await Promise.all([
      app.request('/service-map/admin/api/import/villa', adminRequest(villaState)),
      app.request('/service-map/admin/api/import/villa', adminRequest(villaState)),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it('rejects a group assignment to a domain that does not exist', async () => {
    const app = createApp(config(), { db: testDb() });
    const response = await app.request('/service-map/admin/api/groups', adminRequest({
      id: 'group-a', name: 'A', domainId: 'missing-domain',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unknown_domain' });
  });

  it('rolls back every Villa row and the completion marker if an import fails', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    const service = {
      name: 'A', projectCode: 'a', tier: 'saas', port: null, description: '', cadence: '常時',
      load: 'medium' as const, groupIds: [], pcIds: [], runState: 'unknown', inCatalog: false,
      manual: false, lastSyncedAt: null, updatedAt: NOW,
    };

    await expect(repo.applyVillaImport({
      markerService: 'test-villa-import',
      importedAt: NOW,
      pcs: [{ id: 'pc-a', name: 'A', updatedAt: NOW }],
      // 存在しない domain を参照する group で移行を失敗させる。
      groups: [{ id: 'group-a', name: 'A', domainId: 'missing-domain', updatedAt: NOW }],
      services: [{ ...service, id: 'svc-a', code: 'a' }],
    })).rejects.toThrow();

    expect(await repo.listPcs()).toEqual([]);
    expect(await repo.listGroups()).toEqual([]);
    expect(await repo.listServices()).toEqual([]);
    expect(await repo.getConnectorState('test-villa-import')).toBeNull();
  });

  it('removes deleted PC/group references and keeps a deleted custom group gone after sync', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    await repo.upsertPc({ id: 'pc-a', name: 'A', updatedAt: NOW });
    await repo.upsertGroup({ id: 'group-custom', name: 'Custom', domainId: null, updatedAt: NOW });
    await repo.upsertService({
      id: 'svc-a', code: 'a', name: 'A', projectCode: 'a', tier: 'saas', port: null,
      description: '', cadence: '常時', load: 'medium', groupIds: ['group-custom'], pcIds: ['pc-a'],
      runState: 'running', inCatalog: true, manual: false, lastSyncedAt: NOW, updatedAt: NOW,
    });
    const clients: CalliopeClients = {
      ...makeClients(config()),
      excubitor: {
        health: async () => ({}),
        listServices: async () => [{
          code: 'a', name: 'A', projectCode: 'a', tier: 'saas', port: null,
          description: '', runState: 'running',
        }],
      },
    };
    const app = createApp(config(), { db, clients });
    const deleteRequest = {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    };

    expect((await app.request('/service-map/admin/api/pcs/pc-a', deleteRequest)).status).toBe(200);
    expect((await app.request('/service-map/admin/api/groups/group-custom', deleteRequest)).status).toBe(200);
    expect((await app.request('/service-map/admin/api/sync', adminRequest({}))).status).toBe(200);

    expect((await repo.getService('svc-a'))).toMatchObject({ groupIds: [UNGROUPED_ID], pcIds: [] });
    expect((await repo.listGroups()).some((group) => group.id === 'group-custom')).toBe(false);
  });

  it('does not expose upstream error messages through the public overview', async () => {
    const db = testDb();
    const clients: CalliopeClients = {
      ...makeClients(config()),
      excubitor: {
        health: async () => ({}),
        listServices: async () => {
          throw new Error('request to http://private.internal/catalog failed');
        },
      },
    };
    const app = createApp(config(), { db, clients });

    const response = await app.request('/service-map/public/api/overview');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain('private.internal');
    expect(JSON.parse(body)).toMatchObject({ sync: { state: 'failed', error: 'Error' } });
  });

  it('preserves an admin assignment changed while an Excubitor fetch is in flight', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    await repo.upsertPc({ id: 'pc-old', name: 'Old', updatedAt: NOW });
    await repo.upsertPc({ id: 'pc-new', name: 'New', updatedAt: NOW });
    await repo.upsertGroup({ id: 'group-old', name: 'Old', domainId: null, updatedAt: NOW });
    await repo.upsertGroup({ id: 'group-new', name: 'New', domainId: null, updatedAt: NOW });
    await repo.upsertService({
      id: 'svc-a', code: 'a', name: 'A', projectCode: 'a', tier: 'saas', port: null,
      description: '', cadence: '常時', load: 'medium', groupIds: ['group-old'], pcIds: ['pc-old'],
      runState: 'stopped', inCatalog: true, manual: false, lastSyncedAt: NOW, updatedAt: NOW,
    });

    let releaseCatalog!: () => void;
    let catalogRequested!: () => void;
    const catalogGate = new Promise<void>((resolve) => { releaseCatalog = resolve; });
    const requestStarted = new Promise<void>((resolve) => { catalogRequested = resolve; });
    const clients: CalliopeClients = {
      ...makeClients(config()),
      excubitor: {
        health: async () => ({}),
        listServices: async () => {
          catalogRequested();
          await catalogGate;
          return [{
            code: 'a', name: 'Catalog A', projectCode: 'a', tier: 'saas', port: 3000,
            description: 'catalog', runState: 'running',
          }];
        },
      },
    };
    const app = createApp(config(), { db, clients });

    const syncResponse = app.request('/service-map/admin/api/sync', adminRequest({}));
    await requestStarted;
    const patchResponse = await app.request('/service-map/admin/api/services/svc-a', {
      ...adminRequest({ groupIds: ['group-new'], pcIds: ['pc-new'] }),
      method: 'PATCH',
    });
    releaseCatalog();

    expect(patchResponse.status).toBe(200);
    expect((await syncResponse).status).toBe(200);
    expect(await repo.getService('svc-a')).toMatchObject({
      name: 'Catalog A',
      groupIds: ['group-new'],
      pcIds: ['pc-new'],
      runState: 'running',
    });
  });

  // 管理画面を開くと閲覧時同期が先に走り、catalog 行は svc-<code> で作られる。
  // その後に Villa の legacy ID (prefix なし) を取り込んでも code の unique 制約で
  // 移行全体が落ちてはならない。
  it('accepts a Villa import whose legacy IDs collide with already synced catalog codes', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    const clients: CalliopeClients = {
      ...makeClients(config()),
      excubitor: {
        health: async () => ({}),
        listServices: async () => [{
          code: 'a', name: 'Catalog A', projectCode: 'a', tier: 'saas', port: 3000,
          description: 'catalog', runState: 'running',
        }],
      },
    };
    const app = createApp(config(), { db, clients });

    expect((await app.request('/service-map/admin/api/sync', adminRequest({}))).status).toBe(200);
    expect((await repo.listServices()).map((row) => row.id)).toEqual(['svc-a']);

    const response = await app.request('/service-map/admin/api/import/villa', adminRequest({
      pcs: [{ id: 'pc-a', name: 'A' }],
      groups: [{ id: 'group-a', name: 'A' }],
      workloads: [{ id: 'a', name: 'A', groupIds: ['group-a'], pcIds: ['pc-a'] }],
    }));

    expect(response.status).toBe(200);
    expect((await repo.listServices()).map((row) => row.id)).toEqual(['svc-a']);
    expect(await repo.getService('svc-a')).toMatchObject({
      code: 'a', groupIds: ['group-a'], pcIds: ['pc-a'],
    });
  });

  it('shares one upstream fetch across concurrent anonymous overview requests', async () => {
    let calls = 0;
    let releaseCatalog!: () => void;
    let catalogRequested!: () => void;
    const catalogGate = new Promise<void>((resolve) => { releaseCatalog = resolve; });
    const requestStarted = new Promise<void>((resolve) => { catalogRequested = resolve; });
    const clients: CalliopeClients = {
      ...makeClients(config()),
      excubitor: {
        health: async () => ({}),
        listServices: async () => {
          calls += 1;
          catalogRequested();
          await catalogGate;
          return [];
        },
      },
    };
    const app = createApp(config(), { db: testDb(), clients });

    const first = app.request('/service-map/public/api/overview');
    await requestStarted;
    const rest = [
      app.request('/service-map/public/api/overview'),
      app.request('/service-map/public/api/overview'),
    ];
    // 上流を止めたままマイクロタスクを流し切り、後続 2 本を必ず同期待ちまで進める。
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    releaseCatalog();

    const statuses = (await Promise.all([first, ...rest])).map((response) => response.status);
    expect(statuses).toEqual([200, 200, 200]);
    expect(calls).toBe(1);
  });

  it('does not re-hit a failing Excubitor on every anonymous overview request', async () => {
    let calls = 0;
    const clients: CalliopeClients = {
      ...makeClients(config()),
      excubitor: {
        health: async () => ({}),
        listServices: async () => {
          calls += 1;
          throw new Error('connect ECONNREFUSED');
        },
      },
    };
    const app = createApp(config(), { db: testDb(), clients });

    const first = await (await app.request('/service-map/public/api/overview')).json() as { sync: unknown };
    const second = await (await app.request('/service-map/public/api/overview')).json() as { sync: unknown };

    expect(calls).toBe(1);
    expect(first.sync).toMatchObject({ state: 'failed' });
    expect(second.sync).toEqual(first.sync);
  });

  it('keeps ports out of the anonymous overview even when a description carries them', async () => {
    const db = testDb();
    const repo = makeRepository(db);
    await repo.upsertService({
      id: 'svc-a', code: 'a', name: 'A', projectCode: 'a', tier: 'saas', port: 3000,
      description: 'Villa 由来 (port: 3000, http://127.0.0.1:3000)', cadence: '常時',
      load: 'medium', groupIds: [], pcIds: [], runState: 'running', inCatalog: true,
      manual: false, lastSyncedAt: NOW, updatedAt: NOW,
    });
    const app = createApp(config(), { db });

    const publicBody = await (await app.request('/service-map/public/api/overview')).text();
    expect(publicBody).not.toContain('3000');

    const adminBody = await (await app.request('/service-map/admin/api/overview', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).json() as { services: unknown[] };
    expect(adminBody.services[0]).toMatchObject({
      port: 3000,
      description: 'Villa 由来 (port: 3000, http://127.0.0.1:3000)',
    });
  });

  it('does not grant cross-origin access to the service-map surface', async () => {
    const app = createApp(config(), { db: testDb() });
    const origin = { headers: { origin: 'https://evil.example' } };

    const serviceMap = await app.request('/service-map/public/api/overview', origin);
    expect(serviceMap.headers.get('access-control-allow-origin')).toBeNull();

    const preflight = await app.request('/service-map/admin/api/pcs', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();

    // 既存 API の CORS 挙動は変えない。
    const health = await app.request('/health', origin);
    expect(health.headers.get('access-control-allow-origin')).toBe('*');
  });
});
