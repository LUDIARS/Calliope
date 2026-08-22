// サービスマップの I/O 統括。純粋ロジック (sync.ts / roadmap.ts) と
// clients / repository を配線する。エラーは握り潰さず呼び出し側 (route) に判断させ、
// 遅延同期だけは「表示は生かしつつ失敗を明示して返す」(Villa /map の運用を継承)。

import { randomUUID } from 'node:crypto';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import type { ServiceMapServiceInput, ServiceMapServiceRow } from '../db/repositories/servicemap.ts';
import { composeRoadmap, isRunning, type MemoriaSourceState, type ServiceMapRoadmapPayload } from './roadmap.ts';
import { redactEndpoints } from './sanitize.ts';
import { mergeCatalog, TIER_LABEL, UNGROUPED_ID, UNGROUPED_NAME } from './sync.ts';

const VILLA_IMPORT_MARKER = 'villa-service-map-import';
/** 上流が落ちている間、匿名 read のたびに再試行しないための冷却時間。 */
const SYNC_FAILURE_COOLDOWN_MS = 60_000;

export interface ServiceMapEngineDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

export interface SyncOutcome {
  state: 'synced' | 'fresh' | 'unconfigured' | 'failed';
  syncedAt: string | null;
  error?: string;
  serviceCount?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 匿名でも出してよい項目だけの射影 (ポート・PC 割当・同期メタは含めない)。 */
function sanitizedService(service: ServiceMapServiceRow) {
  return {
    id: service.id,
    code: service.code,
    name: service.name,
    projectCode: service.projectCode,
    tier: service.tier,
    tierLabel: TIER_LABEL[service.tier] ?? service.tier,
    description: redactEndpoints(service.description),
    cadence: service.cadence,
    load: service.load,
    groupIds: service.groupIds,
    runState: service.runState,
    running: isRunning(service.runState),
    inCatalog: service.inCatalog,
  };
}

export function makeServiceMapEngine({ config, clients, repo }: ServiceMapEngineDeps) {
  // 遅延同期は匿名 read からも走る。同時アクセスで上流を叩き重ねないよう進行中の
  // 取得を共有し、失敗直後は cooldown の間キャッシュした結果を返す (admin の強制
  // 同期はどちらも迂回して必ず取りに行く)。
  let inFlight: Promise<SyncOutcome> | null = null;
  let lastFailure: { outcome: SyncOutcome; until: number } | null = null;

  async function runSync(force: boolean): Promise<SyncOutcome> {
    if (!clients.excubitor) {
      return { state: 'unconfigured', syncedAt: null };
    }
    const connector = await repo.getConnectorState('excubitor');
    const freshMs = (config.serviceMapSyncMinutes ?? 10) * 60_000;
    if (!force && connector?.lastSyncAt
      && Date.now() - Date.parse(connector.lastSyncAt) < freshMs) {
      return { state: 'fresh', syncedAt: connector.lastSyncAt };
    }
    const now = nowIso();
    try {
      const catalog = await clients.excubitor.listServices();
      const [existing, groups] = await Promise.all([repo.listServices(), repo.listGroups()]);
      const merged = mergeCatalog(catalog, existing, groups, now);
      await repo.applyCatalogSync(merged.newGroups, merged.services);
      await repo.upsertConnectorState({ service: 'excubitor', health: 'ok', lastSyncAt: now, updatedAt: now });
      return { state: 'synced', syncedAt: now, serviceCount: catalog.length };
    } catch (error) {
      await repo.upsertConnectorState({ service: 'excubitor', health: 'down', lastSyncAt: connector?.lastSyncAt ?? null, updatedAt: now });
      return {
        state: 'failed',
        syncedAt: connector?.lastSyncAt ?? null,
        // overview は公開 API。URL・応答本文・内部詳細は返さない。
        error: error instanceof Error ? error.name : 'UnknownError',
      };
    }
  }

  async function sync(options: { force?: boolean } = {}): Promise<SyncOutcome> {
    const force = options.force === true;
    if (!force) {
      if (lastFailure && Date.now() < lastFailure.until) return lastFailure.outcome;
      if (inFlight) return inFlight;
    }
    const attempt = runSync(force).then((outcome) => {
      lastFailure = outcome.state === 'failed'
        ? { outcome, until: Date.now() + SYNC_FAILURE_COOLDOWN_MS }
        : null;
      return outcome;
    });
    if (force) return attempt;
    inFlight = attempt;
    try {
      return await attempt;
    } finally {
      if (inFlight === attempt) inFlight = null;
    }
  }

  /** 遅延同期込みで台帳を読み出す (public / full の共通材料)。 */
  async function readState() {
    const outcome = await sync();
    const [domains, groups, services, roadmap] = await Promise.all([
      repo.listDomains(),
      repo.listGroups(),
      repo.listServices(),
      repo.getActiveRoadmap(),
    ]);
    return {
      sync: outcome,
      domains: domains.sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name)),
      groups,
      services,
      roadmap: roadmap ? { generatedAt: roadmap.generatedAt, payload: roadmap.payload } : null,
    };
  }

  /** 匿名公開ビュー (/service-map/public): ポート・PC を含まないサニタイズ済み read。 */
  async function publicOverview() {
    const { services, ...rest } = await readState();
    return { ...rest, services: services.map(sanitizedService) };
  }

  /** 認証済みビュー (ルート/admin): publicOverview に加えて PC 台帳・PC割当・ポートなどの管理情報。 */
  async function fullOverview() {
    const [{ services, ...rest }, pcs] = await Promise.all([readState(), repo.listPcs()]);
    return {
      ...rest,
      pcs,
      services: services.map((service) => ({
        ...sanitizedService(service),
        description: service.description,
        port: service.port,
        pcIds: service.pcIds,
        manual: service.manual,
        lastSyncedAt: service.lastSyncedAt,
      })),
    };
  }

  /** 事業ドメイン別ロードマップを生成して supersede 保存する。 */
  async function generateRoadmap(): Promise<ServiceMapRoadmapPayload> {
    const generatedAt = nowIso();
    let memoriaLines: Awaited<ReturnType<NonNullable<CalliopeClients['memoria']>['getRoadmaps']>>['lines'] = [];
    let memoriaState: MemoriaSourceState = 'unconfigured';
    if (clients.memoria) {
      try {
        memoriaLines = (await clients.memoria.getRoadmaps()).lines;
        memoriaState = 'ok';
      } catch (error) {
        // 上流失敗は隠さず成果物に刻む。ローカルの計画成果物だけでも束ねる価値はある。
        memoriaState = `error:${error instanceof Error ? error.name : 'unknown'}`;
      }
    }
    const [domains, groups, services, priorities, sprints] = await Promise.all([
      repo.listDomains(),
      repo.listGroups(),
      repo.listServices(),
      repo.listPriorities({ scope: 'project' }),
      repo.listSprints(),
    ]);
    const payload = composeRoadmap({
      domains,
      groups,
      services,
      memoriaLines,
      memoriaState,
      priorities: priorities.map((row) => ({ ref: row.ref, resolvedScore: row.resolvedScore })),
      sprints: sprints.map((sprint) => ({
        id: sprint.id,
        projectRef: sprint.projectRef,
        status: sprint.status,
        periodEnd: sprint.periodEnd,
      })),
      generatedAt,
    });
    await repo.saveRoadmap({ id: randomUUID(), payload, generatedAt });
    return payload;
  }

  /** Villa villa-state.json ({ state: { pcs, groups, workloads } }) の一回きり移行。 */
  async function importVillaState(state: {
    pcs?: unknown[];
    groups?: unknown[];
    workloads?: unknown[];
  }): Promise<
    | { state: 'imported'; pcs: number; groups: number; services: number }
    | { state: 'already_imported' }
  > {
    const now = nowIso();
    const asRecord = (value: unknown): Record<string, unknown> =>
      (typeof value === 'object' && value !== null ? value as Record<string, unknown> : {});
    const str = (value: unknown, fallback = ''): string =>
      (typeof value === 'string' ? value : fallback);
    const strArray = (value: unknown): string[] =>
      (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

    const pcs = (state.pcs ?? []).map(asRecord).filter((pc) => str(pc.id) && str(pc.name));
    const pcRows = pcs.map((pc) => {
      const priority = str(pc.priority, 'A');
      return {
        id: str(pc.id),
        name: str(pc.name),
        location: str(pc.location),
        role: str(pc.role),
        mode: str(pc.mode, '手動稼働'),
        priority: (['S', 'A', 'B', 'C'] as const).includes(priority as 'S') ? priority as 'S' | 'A' | 'B' | 'C' : 'A',
        os: str(pc.os),
        cpu: str(pc.cpu),
        ram: str(pc.ram),
        gpu: str(pc.gpu),
        storage: str(pc.storage),
        note: str(pc.note),
        updatedAt: now,
      };
    });

    const groups = (state.groups ?? []).map(asRecord).filter((group) => str(group.id) && str(group.name));
    const groupRows = groups.map((group) => ({
      id: str(group.id), name: str(group.name), domainId: null, updatedAt: now,
    }));

    const labelToTier = new Map(Object.entries(TIER_LABEL).map(([tier, label]) => [label, tier]));
    const workloads = (state.workloads ?? []).map(asRecord).filter((work) => str(work.id));
    const rows: ServiceMapServiceInput[] = workloads.map((work) => {
      const id = str(work.id);
      const code = id.startsWith('svc-') ? id.slice(4) : id;
      const description = str(work.description);
      const portMatch = /port:\s*(\d+)/.exec(description);
      const parsedPort = portMatch ? Number(portMatch[1]) : null;
      const load = str(work.load, 'medium');
      const groupIds = strArray(work.groupIds);
      return {
        id,
        code,
        name: str(work.name, code),
        projectCode: code,
        tier: labelToTier.get(str(work.category)) ?? 'saas',
        port: parsedPort && parsedPort <= 65_535 ? parsedPort : null,
        description,
        cadence: str(work.cadence, '常時'),
        load: (['heavy', 'medium', 'light'] as const).includes(load as 'heavy') ? load as 'heavy' | 'medium' | 'light' : 'medium',
        groupIds: groupIds.length ? groupIds : [UNGROUPED_ID],
        pcIds: strArray(work.pcIds),
        runState: 'unknown',
        inCatalog: false, // 次の同期が catalog の今で上書きし、割当は保持される。
        manual: false,
        lastSyncedAt: null,
        updatedAt: now,
      };
    });
    if (rows.some((row) => row.groupIds.includes(UNGROUPED_ID))
      && !groups.some((group) => str(group.id) === UNGROUPED_ID)) {
      groupRows.push({ id: UNGROUPED_ID, name: UNGROUPED_NAME, domainId: null, updatedAt: now });
    }
    const imported = await repo.applyVillaImport({
      markerService: VILLA_IMPORT_MARKER,
      importedAt: now,
      pcs: pcRows,
      groups: groupRows,
      services: rows,
    });
    if (!imported) return { state: 'already_imported' };
    return { state: 'imported', pcs: pcRows.length, groups: groups.length, services: rows.length };
  }

  return { sync, publicOverview, fullOverview, generateRoadmap, importVillaState };
}

export type ServiceMapEngine = ReturnType<typeof makeServiceMapEngine>;
