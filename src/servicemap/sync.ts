// サービスマップの同期マージ (純粋ロジック)。
// 正本は Excubitor catalog。ここでの仕事は「catalog の今」と「保存済みの割当」を
// 割当を失わずに合成すること。Villa /map の mergeAssignments / buildGrouping を継承する。

import type { CatalogService } from '../clients/excubitor.ts';
import type {
  ServiceMapGroupInput,
  ServiceMapGroupRow,
  ServiceMapServiceInput,
  ServiceMapServiceRow,
} from '../db/repositories/servicemap.ts';

export const UNGROUPED_ID = 'group-ungrouped';
export const UNGROUPED_NAME = '未分類';

const INFRA_GROUP = { id: 'group-infra', name: 'Infra' };
const TIER_GROUP: Record<string, { id: string; name: string } | undefined> = {
  infra: INFRA_GROUP,
  saas: { id: 'group-saas', name: 'SaaS' },
  personal: { id: 'group-personal', name: '個人ツール' },
  'local-app': { id: 'group-local-app', name: 'ローカルアプリ' },
};

export const TIER_LABEL: Record<string, string> = {
  saas: 'SaaS',
  infra: '共有インフラ',
  personal: '個人ツール',
  'local-app': 'ローカルアプリ',
};

// tier ごとの既定稼働方針。ローカルアプリだけは人が前にいる時だけ動く。
const CADENCE_BY_TIER: Record<string, string> = {
  infra: '常時', saas: '常時', personal: '常時', 'local-app': '必要時',
};
const LOAD_BY_TIER: Record<string, 'heavy' | 'medium' | 'light'> = {
  infra: 'medium', saas: 'medium', personal: 'light', 'local-app': 'medium',
};

/**
 * 取り込み時の既定グループを決める。
 * 「丸ごと1単位で扱う」画面なので、既定は粗く少数に寄せる:
 *   - 複数サービスを持つプロジェクトは、それ自体が1グループ
 *   - 単独サービスは tier のバケツ (Infra / SaaS / 個人ツール / ローカルアプリ)
 * 事業ドメインへの所属はグループ単位で人が決める (推測しない)。
 */
export function buildGrouping(services: CatalogService[]) {
  const countByProject = new Map<string, number>();
  for (const service of services) {
    const key = service.projectCode || service.code;
    countByProject.set(key, (countByProject.get(key) ?? 0) + 1);
  }
  return (service: CatalogService): { id: string; name: string } => {
    if (service.tier === 'infra') return INFRA_GROUP;
    const key = service.projectCode || service.code;
    if ((countByProject.get(key) ?? 0) >= 2) {
      return { id: `group-${key}`, name: key.charAt(0).toUpperCase() + key.slice(1) };
    }
    return TIER_GROUP[service.tier] ?? { id: 'group-other', name: 'その他' };
  };
}

export interface SyncMergeResult {
  services: ServiceMapServiceInput[];
  /** 新規に必要になった既定グループ (既存グループは触らない)。 */
  newGroups: ServiceMapGroupInput[];
}

/**
 * catalog スナップショットを保存済み台帳へマージする。
 * - 既存行: 割当 (groupIds / pcIds) と手で整えた cadence / load を保持し、
 *   名前・ポート・説明・稼働状態だけ catalog の今で更新する。
 * - 新規行: 既定グループへ入れて追加する。
 * - catalog から消えた行: 消さずに inCatalog=false を立てる (手動行はそのまま)。
 */
export function mergeCatalog(
  catalog: CatalogService[],
  existing: ServiceMapServiceRow[],
  existingGroups: ServiceMapGroupRow[],
  now: string,
): SyncMergeResult {
  const groupOf = buildGrouping(catalog);
  const byId = new Map(existing.map((row) => [row.id, row]));
  const byCode = new Map(existing.map((row) => [row.code, row]));
  const knownGroupIds = new Set(existingGroups.map((group) => group.id));
  const newGroups = new Map<string, ServiceMapGroupInput>();
  const seen = new Set<string>();
  const services: ServiceMapServiceInput[] = [];

  for (const service of catalog) {
    const generatedId = `svc-${service.code}`;
    // Villa 側の legacy ID が svc- prefix なしでも、unique code を同一サービスとして引き継ぐ。
    const before = byId.get(generatedId) ?? byCode.get(service.code);
    const id = before?.id ?? generatedId;
    seen.add(id);
    const defaultGroup = groupOf(service);
    const groupIds = before && before.groupIds.length ? before.groupIds : [defaultGroup.id];
    for (const groupId of groupIds) {
      if (!knownGroupIds.has(groupId) && !newGroups.has(groupId)) {
        newGroups.set(groupId, {
          id: groupId,
          name: groupId === defaultGroup.id
            ? defaultGroup.name
            : groupId === UNGROUPED_ID ? UNGROUPED_NAME : groupId,
          domainId: null,
          updatedAt: now,
        });
      }
    }
    services.push({
      id,
      code: service.code,
      name: service.name,
      projectCode: service.projectCode,
      tier: service.tier,
      port: service.port,
      description: service.description,
      cadence: before?.cadence ?? CADENCE_BY_TIER[service.tier] ?? '常時',
      load: before?.load ?? LOAD_BY_TIER[service.tier] ?? 'medium',
      groupIds,
      pcIds: before ? before.pcIds : [],
      runState: service.runState,
      inCatalog: true,
      manual: false,
      lastSyncedAt: now,
      updatedAt: now,
    });
  }

  for (const row of existing) {
    if (seen.has(row.id)) continue;
    if (row.manual) continue; // 手動行は同期対象外。触らない。
    if (!row.inCatalog) continue; // 既に消滅マーク済み。
    services.push({ ...row, inCatalog: false, runState: 'unknown', updatedAt: now });
  }

  return { services, newGroups: [...newGroups.values()] };
}
