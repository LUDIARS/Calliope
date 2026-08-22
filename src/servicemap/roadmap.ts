// 事業ドメイン別ロードマップの合成 (純粋ロジック)。
// エンジンは二重実装しない: ロードマップ路線の正本は Memoria、優先度解決値と
// スプリントは Calliope 自DBの計画成果物。ここではそれらを事業ドメイン軸で束ねるだけ。

import type { Roadmaps } from '../clients/contracts.ts';
import type {
  ServiceMapDomainRow,
  ServiceMapGroupRow,
  ServiceMapServiceRow,
} from '../db/repositories/servicemap.ts';

export interface RoadmapPriorityRow {
  ref: string;
  resolvedScore: number;
}

export interface RoadmapSprintRow {
  id: string;
  projectRef: string;
  status: string;
  periodEnd: string;
}

export type MemoriaSourceState = 'ok' | 'unconfigured' | `error:${string}`;

export interface ComposeRoadmapInput {
  domains: ServiceMapDomainRow[];
  groups: ServiceMapGroupRow[];
  services: ServiceMapServiceRow[];
  memoriaLines: Roadmaps['lines'];
  memoriaState: MemoriaSourceState;
  priorities: RoadmapPriorityRow[];
  sprints: RoadmapSprintRow[];
  generatedAt: string;
}

export interface DomainRoadmapLine {
  code: string;
  title: string;
  repos: { repo: string; importance: number }[];
}

export interface DomainRoadmap {
  id: string;
  name: string;
  note: string;
  serviceCount: number;
  runningCount: number;
  projects: string[];
  services: { id: string; code: string; name: string; projectCode: string; runState: string; cadence: string }[];
  lines: DomainRoadmapLine[];
  priorities: { ref: string; score: number }[];
  sprints: RoadmapSprintRow[];
}

export interface ServiceMapRoadmapPayload {
  generatedAt: string;
  domains: DomainRoadmap[];
  /** どのドメインにも属さないグループのサービス。割り漏れを隠さない。 */
  unassigned: { groupNames: string[]; serviceCount: number };
  sources: { memoria: MemoriaSourceState };
}

function normalizeRepo(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const RUNNING_STATES = new Set(['running', 'ok', 'up', 'healthy']);

export function isRunning(runState: string): boolean {
  return RUNNING_STATES.has(runState.toLowerCase());
}

/** 保存済みの台帳と上流スナップショットを、事業ドメイン軸のロードマップへ束ねる。 */
export function composeRoadmap(input: ComposeRoadmapInput): ServiceMapRoadmapPayload {
  const groupsByDomain = new Map<string, ServiceMapGroupRow[]>();
  const orphanGroups: ServiceMapGroupRow[] = [];
  const knownDomainIds = new Set(input.domains.map((domain) => domain.id));
  for (const group of input.groups) {
    if (!group.domainId || !knownDomainIds.has(group.domainId)) {
      orphanGroups.push(group);
      continue;
    }
    const bucket = groupsByDomain.get(group.domainId) ?? [];
    bucket.push(group);
    groupsByDomain.set(group.domainId, bucket);
  }

  const servicesOfGroups = (groupIds: Set<string>) =>
    input.services.filter((service) => service.groupIds.some((id) => groupIds.has(id)));

  const domains = [...input.domains]
    .sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name))
    .map((domain): DomainRoadmap => {
      const groupIds = new Set((groupsByDomain.get(domain.id) ?? []).map((group) => group.id));
      const services = servicesOfGroups(groupIds);
      const projects = [...new Set(services.map((service) => service.projectCode))].sort();
      const projectKeys = new Set(projects.map(normalizeRepo));

      const lines: DomainRoadmapLine[] = input.memoriaLines
        .filter((line) => projectKeys.has(normalizeRepo(line.repo))
          || line.members.some((member) => projectKeys.has(normalizeRepo(member.repo))))
        .map((line) => ({
          code: line.line.code,
          title: line.line.title,
          repos: line.members
            .filter((member) => projectKeys.has(normalizeRepo(member.repo)))
            .map((member) => ({ repo: member.repo, importance: member.importance })),
        }));

      const priorities = input.priorities
        .filter((row) => projectKeys.has(normalizeRepo(row.ref)))
        .map((row) => ({ ref: row.ref, score: row.resolvedScore }))
        .sort((a, b) => b.score - a.score);

      const sprints = input.sprints
        .filter((sprint) => projectKeys.has(normalizeRepo(sprint.projectRef)));

      return {
        id: domain.id,
        name: domain.name,
        note: domain.note,
        serviceCount: services.length,
        runningCount: services.filter((service) => isRunning(service.runState)).length,
        projects,
        services: services.map((service) => ({
          id: service.id,
          code: service.code,
          name: service.name,
          projectCode: service.projectCode,
          runState: service.runState,
          cadence: service.cadence,
        })),
        lines,
        priorities,
        sprints,
      };
    });

  const domainGroupIds = new Set(
    [...groupsByDomain.values()].flat().map((group) => group.id),
  );
  // groupIds=[] や削除済み ID だけを持つ行も、割り漏れとして隠さない。
  const unassignedServices = input.services.filter((service) =>
    !service.groupIds.some((groupId) => domainGroupIds.has(groupId)));

  return {
    generatedAt: input.generatedAt,
    domains,
    unassigned: {
      groupNames: orphanGroups.map((group) => group.name).sort(),
      serviceCount: unassignedServices.length,
    },
    sources: { memoria: input.memoriaState },
  };
}
