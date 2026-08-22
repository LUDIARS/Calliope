import { describe, expect, it } from 'vitest';
import type { ServiceMapDomainRow, ServiceMapGroupRow, ServiceMapServiceRow } from '../../db/repositories/servicemap.ts';
import { composeRoadmap, isRunning } from '../roadmap.ts';

const NOW = '2026-08-13T12:00:00.000Z';

const domain = (id: string, name: string, seq = 0): ServiceMapDomainRow =>
  ({ id, name, note: '', seq, updatedAt: NOW });

const group = (id: string, name: string, domainId: string | null): ServiceMapGroupRow =>
  ({ id, name, domainId, updatedAt: NOW });

function service(overrides: Partial<ServiceMapServiceRow>): ServiceMapServiceRow {
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
    groupIds: [],
    pcIds: [],
    runState: 'unknown',
    inCatalog: true,
    manual: false,
    lastSyncedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('composeRoadmap', () => {
  it('事業ドメイン単位でサービス・Memoria 路線・優先度・スプリントを束ねる', () => {
    const payload = composeRoadmap({
      domains: [domain('domain-edu', '教育', 1), domain('domain-game', 'ゲーム', 2)],
      groups: [
        group('group-projecthub', 'PROJECTHUB', 'domain-edu'),
        group('group-games', 'ゲーム', 'domain-game'),
        group('group-orphan', '未所属', null),
      ],
      services: [
        service({ id: 'svc-projecthub', code: 'projecthub', projectCode: 'projecthub', groupIds: ['group-projecthub'], runState: 'running' }),
        service({ id: 'svc-tirocinium', code: 'tirocinium', projectCode: 'tirocinium', groupIds: ['group-projecthub'], runState: 'stopped' }),
        service({ id: 'svc-pagus', code: 'pagus', projectCode: 'pagus', groupIds: ['group-games'] }),
        service({ id: 'svc-lost', code: 'lost', projectCode: 'lost', groupIds: ['group-orphan'] }),
      ],
      memoriaLines: [
        {
          repo: 'PROJECTHUB',
          line: { id: '1', code: 'L1', title: '学校運営強化' },
          members: [{ repo: 'PROJECTHUB', importance: 3 }, { repo: 'Tirocinium', importance: 2 }],
        },
        {
          repo: 'Pictor',
          line: { id: '2', code: 'L2', title: '描画基盤' },
          members: [{ repo: 'Pictor', importance: 3 }],
        },
      ],
      memoriaState: 'ok',
      priorities: [
        { ref: 'projecthub', resolvedScore: 0.9 },
        { ref: 'tirocinium', resolvedScore: 0.4 },
        { ref: 'unrelated', resolvedScore: 1.0 },
      ],
      sprints: [
        { id: 'sp1', projectRef: 'projecthub', status: 'active', periodEnd: '2026-08-20' },
        { id: 'sp2', projectRef: 'pictor', status: 'active', periodEnd: '2026-08-20' },
      ],
      generatedAt: NOW,
    });

    expect(payload.domains.map((d) => d.name)).toEqual(['教育', 'ゲーム']);
    const edu = payload.domains[0]!;
    expect(edu.serviceCount).toBe(2);
    expect(edu.runningCount).toBe(1);
    expect(edu.projects).toEqual(['projecthub', 'tirocinium']);
    expect(edu.lines.map((line) => line.code)).toEqual(['L1']);
    expect(edu.lines[0]!.repos).toEqual([
      { repo: 'PROJECTHUB', importance: 3 },
      { repo: 'Tirocinium', importance: 2 },
    ]);
    expect(edu.priorities).toEqual([
      { ref: 'projecthub', score: 0.9 },
      { ref: 'tirocinium', score: 0.4 },
    ]);
    expect(edu.sprints.map((sprint) => sprint.id)).toEqual(['sp1']);

    const game = payload.domains[1]!;
    expect(game.lines).toHaveLength(0);
    expect(payload.unassigned).toEqual({ groupNames: ['未所属'], serviceCount: 1 });
    expect(payload.sources.memoria).toBe('ok');
  });

  it('memoria 未設定でもローカルの計画成果物だけで束ね、状態を成果物に刻む', () => {
    const payload = composeRoadmap({
      domains: [domain('domain-a', 'A')],
      groups: [group('group-a', 'A', 'domain-a')],
      services: [service({ id: 'svc-a', code: 'a', projectCode: 'a', groupIds: ['group-a'] })],
      memoriaLines: [],
      memoriaState: 'unconfigured',
      priorities: [],
      sprints: [],
      generatedAt: NOW,
    });
    expect(payload.sources.memoria).toBe('unconfigured');
    expect(payload.domains[0]!.serviceCount).toBe(1);
  });

  it('空または削除済みの group ID だけを持つサービスも未所属に数える', () => {
    const payload = composeRoadmap({
      domains: [domain('domain-a', 'A')],
      groups: [group('group-a', 'A', 'domain-a')],
      services: [
        service({ id: 'svc-empty', groupIds: [] }),
        service({ id: 'svc-dangling', groupIds: ['group-deleted'] }),
        service({ id: 'svc-assigned', groupIds: ['group-a'] }),
      ],
      memoriaLines: [],
      memoriaState: 'ok',
      priorities: [],
      sprints: [],
      generatedAt: NOW,
    });

    expect(payload.unassigned.serviceCount).toBe(2);
  });
});

describe('isRunning', () => {
  it('running 系の状態だけを稼働中と判定する', () => {
    expect(isRunning('running')).toBe(true);
    expect(isRunning('RUNNING')).toBe(true);
    expect(isRunning('stopped')).toBe(false);
    expect(isRunning('unknown')).toBe(false);
  });
});
