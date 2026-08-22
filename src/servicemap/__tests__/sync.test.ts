import { describe, expect, it } from 'vitest';
import type { CatalogService } from '../../clients/excubitor.ts';
import type { ServiceMapGroupRow, ServiceMapServiceRow } from '../../db/repositories/servicemap.ts';
import { buildGrouping, mergeCatalog } from '../sync.ts';

const NOW = '2026-08-13T12:00:00.000Z';

function catalogService(overrides: Partial<CatalogService>): CatalogService {
  return {
    code: 'svc',
    name: 'Service',
    projectCode: 'svc',
    tier: 'saas',
    port: null,
    description: '',
    runState: 'running',
    ...overrides,
  };
}

function existingService(overrides: Partial<ServiceMapServiceRow>): ServiceMapServiceRow {
  return {
    id: 'svc-x',
    code: 'x',
    name: 'X',
    projectCode: 'x',
    tier: 'saas',
    port: null,
    description: '',
    cadence: '常時',
    load: 'medium',
    groupIds: ['group-saas'],
    pcIds: [],
    runState: 'unknown',
    inCatalog: true,
    manual: false,
    lastSyncedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

const group = (id: string, name: string): ServiceMapGroupRow => ({ id, name, domainId: null, updatedAt: NOW });

describe('buildGrouping', () => {
  it('複数サービスを持つプロジェクトはプロジェクト自身が1グループになる', () => {
    const services = [
      catalogService({ code: 'concordia', projectCode: 'concordia', tier: 'personal' }),
      catalogService({ code: 'concordia-web', projectCode: 'concordia', tier: 'personal' }),
      catalogService({ code: 'genius', projectCode: 'genius', tier: 'personal' }),
    ];
    const groupOf = buildGrouping(services);
    expect(groupOf(services[0]!).id).toBe('group-concordia');
    expect(groupOf(services[2]!).id).toBe('group-personal');
  });

  it('infra はプロジェクト数に関わらず Infra バケツへ入る', () => {
    const services = [
      catalogService({ code: 'infra-postgres', projectCode: 'infra', tier: 'infra' }),
      catalogService({ code: 'infra-redis', projectCode: 'infra', tier: 'infra' }),
    ];
    const groupOf = buildGrouping(services);
    expect(groupOf(services[0]!).id).toBe('group-infra');
  });
});

describe('mergeCatalog', () => {
  it('既存の割当と手直しした cadence / load を保持し、catalog の今で表示情報を更新する', () => {
    const existing = existingService({
      id: 'svc-actio',
      code: 'actio',
      name: '旧名',
      cadence: '必要時',
      load: 'heavy',
      groupIds: ['group-custom'],
      pcIds: ['pc-haster'],
      runState: 'stopped',
    });
    const catalog = [catalogService({ code: 'actio', name: 'Actio', projectCode: 'actio', port: 3000, runState: 'running' })];
    const result = mergeCatalog(catalog, [existing], [group('group-custom', '手動グループ')], NOW);
    const merged = result.services.find((row) => row.id === 'svc-actio');
    expect(merged).toMatchObject({
      name: 'Actio',
      port: 3000,
      runState: 'running',
      cadence: '必要時',
      load: 'heavy',
      groupIds: ['group-custom'],
      pcIds: ['pc-haster'],
      inCatalog: true,
    });
    expect(result.newGroups).toHaveLength(0);
  });

  it('新規サービスは既定グループへ入り、必要なグループだけ新設される', () => {
    const catalog = [
      catalogService({ code: 'concordia', projectCode: 'concordia', tier: 'personal' }),
      catalogService({ code: 'concordia-web', projectCode: 'concordia', tier: 'personal' }),
    ];
    const result = mergeCatalog(catalog, [], [], NOW);
    expect(result.services.every((row) => row.groupIds.includes('group-concordia'))).toBe(true);
    expect(result.newGroups.map((g) => g.id)).toEqual(['group-concordia']);
  });

  it('svc- prefix のない Villa ID も code で同一視して割当を引き継ぐ', () => {
    const existing = existingService({
      id: 'actio',
      code: 'actio',
      groupIds: ['group-custom'],
      pcIds: ['pc-a'],
    });
    const result = mergeCatalog(
      [catalogService({ code: 'actio', projectCode: 'actio' })],
      [existing],
      [group('group-custom', '手動グループ')],
      NOW,
    );

    expect(result.services).toContainEqual(expect.objectContaining({
      id: 'actio',
      code: 'actio',
      groupIds: ['group-custom'],
      pcIds: ['pc-a'],
    }));
  });

  it('catalog から消えたサービスは削除せず inCatalog=false で残す', () => {
    const existing = existingService({ id: 'svc-gone', code: 'gone', runState: 'running' });
    const result = mergeCatalog([], [existing], [group('group-saas', 'SaaS')], NOW);
    const gone = result.services.find((row) => row.id === 'svc-gone');
    expect(gone).toMatchObject({ inCatalog: false, runState: 'unknown' });
  });

  it('手動追加サービスと消滅マーク済みサービスには触らない', () => {
    const manual = existingService({ id: 'svc-manual', code: 'manual', manual: true });
    const alreadyGone = existingService({ id: 'svc-old', code: 'old', inCatalog: false });
    const result = mergeCatalog([], [manual, alreadyGone], [], NOW);
    expect(result.services).toHaveLength(0);
  });
});
