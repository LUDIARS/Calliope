// サービスマップ (Villa /map から移設) の HTTP 層。
// - /service-map          : 公開ビュー (検索 / 事業ドメイン別 / 稼働状態 / ロードマップ閲覧)
// - /service-map/admin    : 管理ビュー (PC 台帳・割当・ポート・編集・同期・生成・移行)
// - read API は /service-map/{public/api,api} (Calliope service token とは独立)。
// - 管理 API は /service-map/admin/api/* で任意の CALLIOPE_SERVICEMAP_ADMIN_TOKEN を追加適用。
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeServiceMapEngine } from '../servicemap/engine.ts';
import { UNGROUPED_ID, UNGROUPED_NAME } from '../servicemap/sync.ts';
import { serviceMapHtml } from '../servicemap/ui/html.ts';
import { serviceMapCss } from '../servicemap/ui/styles.ts';
import { serviceMapScript } from '../servicemap/ui/script.ts';

interface ServiceMapDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

/**
 * admin API の追加ゲート。経路認証は Cloudflare Access が正 (public 以下=匿名可 /
 * ルート以下=認証 / admin=管理者)。CALLIOPE_SERVICEMAP_ADMIN_TOKEN を設定した場合のみ
 * アプリ層でも Bearer を要求する (defense in depth)。未設定は CF に委ねて素通し。
 */
function adminAuth(adminToken: string | null): MiddlewareHandler {
  return async (c, next) => {
    if (!adminToken) {
      await next();
      return;
    }
    const authorization = c.req.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    const expected = Buffer.from(adminToken);
    const actual = token ? Buffer.from(token) : Buffer.alloc(0);
    if (!token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}

const idSchema = z.string().min(1).max(120);
const MAX_ADMIN_BODY_BYTES = 2 * 1024 * 1024;

const pcInputSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1).max(60),
  location: z.string().max(60).default(''),
  role: z.string().max(80).default(''),
  mode: z.string().max(20).default('手動稼働'),
  priority: z.enum(['S', 'A', 'B', 'C']).default('A'),
  os: z.string().max(60).default(''),
  cpu: z.string().max(90).default(''),
  ram: z.string().max(40).default(''),
  gpu: z.string().max(90).default(''),
  storage: z.string().max(60).default(''),
  note: z.string().max(300).default(''),
});

const domainInputSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1).max(60),
  note: z.string().max(300).default(''),
  seq: z.number().int().min(0).default(0),
});

const groupInputSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1).max(60),
  domainId: idSchema.nullable().default(null),
});

const serviceAssignSchema = z.object({
  groupIds: z.array(idSchema).max(30)
    .transform((ids) => ids.length ? [...new Set(ids)] : [UNGROUPED_ID])
    .optional(),
  pcIds: z.array(idSchema).max(30).transform((ids) => [...new Set(ids)]).optional(),
  cadence: z.string().max(20).optional(),
  load: z.enum(['heavy', 'medium', 'light']).optional(),
});

const villaPcSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(60),
  location: z.string().max(60).optional(),
  role: z.string().max(80).optional(),
  mode: z.string().max(20).optional(),
  priority: z.string().max(10).optional(),
  os: z.string().max(60).optional(),
  cpu: z.string().max(90).optional(),
  ram: z.string().max(40).optional(),
  gpu: z.string().max(90).optional(),
  storage: z.string().max(60).optional(),
  note: z.string().max(300).optional(),
}).passthrough();

const villaGroupSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(60),
}).passthrough();

const villaWorkloadSchema = z.object({
  id: idSchema,
  name: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  category: z.string().max(60).optional(),
  cadence: z.string().max(20).optional(),
  load: z.string().max(20).optional(),
  groupIds: z.array(idSchema).max(30).optional(),
  pcIds: z.array(idSchema).max(30).optional(),
}).passthrough();

const villaStateSchema = z.object({
  pcs: z.array(villaPcSchema).max(100).optional(),
  groups: z.array(villaGroupSchema).max(500).optional(),
  workloads: z.array(villaWorkloadSchema).max(2_000).optional(),
}).refine((state) => (state.pcs?.length ?? 0) + (state.groups?.length ?? 0)
  + (state.workloads?.length ?? 0) > 0, { message: 'villa_state_must_not_be_empty' });

// villa-state.json そのまま ({updated_at, state}) と state 単体の両方を受ける。
const villaImportSchema = z.union([
  z.object({ state: villaStateSchema }).passthrough(),
  villaStateSchema,
]);

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** body を検証し、失敗は 400 で返す (mount 越しの onError に依存しない)。 */
async function parseBody<T>(schema: z.ZodType<T>, c: Context): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => {
    throw new HTTPException(400, { res: Response.json({ error: 'body_must_be_json' }, { status: 400 }) });
  }));
  if (!parsed.success) {
    throw new HTTPException(400, {
      res: Response.json({
        error: 'invalid_body',
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
      }, { status: 400 }),
    });
  }
  return parsed.data;
}

export function mountServiceMapRoutes(app: Hono, deps: ServiceMapDeps) {
  const engine = makeServiceMapEngine(deps);
  const routes = new Hono();

  const pageHeaders = {
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  // 経路と CF Access ポリシーの対応:
  //   /service-map/public 以下 … 匿名可 (サニタイズ済み read + 共有アセット)
  //   /service-map ルート以下  … CF 認証ユーザー (フル閲覧: ポート・PC 台帳込み)
  //   /service-map/admin 以下  … CF 管理者 (+任意でアプリ層 Bearer)
  routes.get('/', (c) => c.html(serviceMapHtml({ mode: 'root' }), 200, pageHeaders));
  routes.get('/admin', (c) => c.html(serviceMapHtml({ mode: 'admin' }), 200, pageHeaders));
  routes.get('/public', (c) => c.html(serviceMapHtml({ mode: 'public' }), 200, pageHeaders));
  // アセットは匿名ページからも読むため public 以下で配る (全モード共有)。
  routes.get('/public/assets/servicemap.css', (c) => c.body(serviceMapCss, 200, { 'content-type': 'text/css; charset=utf-8' }));
  routes.get('/public/assets/servicemap.js', (c) => c.body(serviceMapScript, 200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
  }));

  routes.get('/public/api/overview', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await engine.publicOverview());
  });
  routes.get('/api/overview', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await engine.fullOverview());
  });

  const admin = new Hono();
  admin.use('*', adminAuth(deps.config.serviceMapAdminToken ?? null));
  admin.use('*', bodyLimit({
    maxSize: MAX_ADMIN_BODY_BYTES,
    onError: (c) => c.json({ error: 'payload_too_large' }, 413),
  }));

  admin.get('/overview', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await engine.fullOverview());
  });

  admin.post('/sync', async (c) => {
    const outcome = await engine.sync({ force: true });
    if (outcome.state === 'unconfigured') {
      return c.json({ error: 'excubitor_unconfigured', hint: 'Set EXCUBITOR_BASE_URL.' }, 503);
    }
    if (outcome.state === 'failed') {
      return c.json({ error: 'excubitor_sync_failed', reason: outcome.error }, 502);
    }
    return c.json(outcome);
  });

  admin.post('/roadmap/generate', async (c) => c.json({ roadmap: await engine.generateRoadmap() }));

  admin.post('/pcs', async (c) => {
    const input = await parseBody(pcInputSchema, c);
    const id = input.id ?? newId('pc');
    await deps.repo.upsertPc({ ...input, id, updatedAt: new Date().toISOString() });
    return c.json({ id });
  });

  admin.delete('/pcs/:id', async (c) => {
    await deps.repo.deletePc(c.req.param('id'), new Date().toISOString());
    return c.json({ deleted: true });
  });

  admin.post('/domains', async (c) => {
    const input = await parseBody(domainInputSchema, c);
    const id = input.id ?? newId('domain');
    await deps.repo.upsertDomain({ ...input, id, updatedAt: new Date().toISOString() });
    return c.json({ id });
  });

  admin.delete('/domains/:id', async (c) => {
    await deps.repo.deleteDomain(c.req.param('id'));
    return c.json({ deleted: true });
  });

  admin.post('/groups', async (c) => {
    const input = await parseBody(groupInputSchema, c);
    if (input.domainId) {
      const domains = await deps.repo.listDomains();
      if (!domains.some((domain) => domain.id === input.domainId)) {
        return c.json({ error: 'unknown_domain' }, 400);
      }
    }
    const id = input.id ?? newId('group');
    await deps.repo.upsertGroup({ ...input, id, updatedAt: new Date().toISOString() });
    return c.json({ id });
  });

  admin.delete('/groups/:id', async (c) => {
    const id = c.req.param('id');
    if (id === UNGROUPED_ID) return c.json({ error: 'ungrouped_group_cannot_be_deleted' }, 400);
    await deps.repo.deleteGroup(id, {
      id: UNGROUPED_ID,
      name: UNGROUPED_NAME,
      domainId: null,
      updatedAt: new Date().toISOString(),
    });
    return c.json({ deleted: true });
  });

  admin.patch('/services/:id', async (c) => {
    const id = c.req.param('id');
    const existing = await deps.repo.getService(id);
    if (!existing) return c.json({ error: 'service_not_found' }, 404);
    const patch = await parseBody(serviceAssignSchema, c);
    const [groups, pcs] = await Promise.all([deps.repo.listGroups(), deps.repo.listPcs()]);
    const groupIds = new Set(groups.map((group) => group.id));
    const pcIds = new Set(pcs.map((pc) => pc.id));
    const unknownGroupIds = patch.groupIds
      ?.filter((groupId) => groupId !== UNGROUPED_ID && !groupIds.has(groupId)) ?? [];
    const unknownPcIds = patch.pcIds?.filter((pcId) => !pcIds.has(pcId)) ?? [];
    if (unknownGroupIds.length || unknownPcIds.length) {
      return c.json({ error: 'unknown_assignment_target', unknownGroupIds, unknownPcIds }, 400);
    }
    if (patch.groupIds?.includes(UNGROUPED_ID)) {
      await deps.repo.upsertGroup({
        id: UNGROUPED_ID,
        name: UNGROUPED_NAME,
        domainId: null,
        updatedAt: new Date().toISOString(),
      });
    }
    await deps.repo.patchService(id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    return c.json({ id });
  });

  admin.post('/import/villa', async (c) => {
    const body = await parseBody(villaImportSchema, c);
    const state = 'state' in body ? body.state : body;
    const result = await engine.importVillaState(state);
    if (result.state === 'already_imported') {
      return c.json({ error: 'villa_state_already_imported' }, 409);
    }
    return c.json(result);
  });

  routes.route('/admin/api', admin);
  app.route('/service-map', routes);
}
