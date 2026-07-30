// スプリント候補タスクの正規化。
// Actio PM プロジェクト (pm/projects + pm/tasks) と PROJECTHUB scope (Actio コア tasks の
// project_id 紐付け、docs/design/projecthub-pm.md H1/H4) はソースの形が異なるため、
// スコープごとの読み出しは別ファイル (engine.ts / projecthub-tasks.ts) に任せ、
// このファイルは両者が合流する「候補タスク」の形と組み立てロジックだけを持つ (SRP)。

import type { PmTask } from '../clients/contracts.ts';
import { isCompletedStatus } from '../planning/tasks.ts';
import { makeTaskRef } from '../refs.ts';
import type { CapacityTask } from './capacity.ts';

export interface SprintTaskCandidate extends CapacityTask {
  sourceId: string;
  sourceStatus: string;
  labels: string[];
  createdAt: string;
}

export interface CandidateBuildResult {
  candidates: SprintTaskCandidate[];
  missingEstimates: string[];
  missingPriorities: string[];
}

export function taskRefForPmTask(projectId: string, task: PmTask): string {
  return makeTaskRef('actio-pm', projectId, task.externalId);
}

/** Actio PM project (docs/design/scheduling.md 由来の既存能力C) のタスクから候補を組み立てる。 */
export function buildCandidates(
  projectId: string,
  tasks: PmTask[],
  estimates: Array<{ taskRef: string; effortMinutes: number }>,
  priorities: Array<{ ref: string; resolvedScore: number }>,
): CandidateBuildResult {
  const estimatesByRef = new Map(estimates.map((row) => [row.taskRef, row.effortMinutes]));
  const prioritiesByRef = new Map(priorities.map((row) => [row.ref, row.resolvedScore]));
  const statusByIdentifier = new Map<string, string>();
  for (const task of tasks) {
    statusByIdentifier.set(task.id, task.status);
    statusByIdentifier.set(task.externalId, task.status);
  }
  const missingEstimates: string[] = [];
  const missingPriorities: string[] = [];
  const candidates: SprintTaskCandidate[] = [];
  for (const task of tasks) {
    if (isCompletedStatus(task.status) || task.labels.some((label) => label.toLowerCase() === 'human-gate')) continue;
    const ref = taskRefForPmTask(projectId, task);
    const effortMinutes = task.estimatedHours === null
      ? estimatesByRef.get(ref) ?? null
      : task.estimatedHours * 60;
    if (effortMinutes === null || effortMinutes <= 0) {
      missingEstimates.push(ref);
      continue;
    }
    const priority = prioritiesByRef.get(ref);
    if (priority === undefined) missingPriorities.push(ref);
    const isReady = task.blockedBy.every((identifier) => {
      const status = statusByIdentifier.get(identifier);
      return status !== undefined && isCompletedStatus(status);
    });
    candidates.push({
      taskRef: ref,
      sourceId: task.id,
      sourceStatus: task.status,
      labels: task.labels,
      createdAt: task.createdAt,
      effortMinutes,
      priority: priority ?? 0,
      isReady,
    });
  }
  return { candidates, missingEstimates, missingPriorities };
}

/**
 * PROJECTHUB scope (`projecthub:<project_id>`) 用のタスク正規化形。
 * Actio コアの `tasks` (project_id 紐付け) から作る — PROJECTHUB 側にタスクエンジンを
 * 二重実装しない (docs/design/projecthub-pm.md H1 最終裁定)。
 */
export interface ProjectHubSprintTask {
  taskRef: string;
  sourceId: string;
  sourceStatus: string;
  labels: string[];
  createdAt: string;
  completedAt: string | null;
  /** 学生申告の estimated_minutes、または task_estimate (EstimationService 補完値)。 */
  declaredEffortMinutes: number | null;
  isHumanGate: boolean;
}

/**
 * PROJECTHUB scope の候補組み立て。 PM 版と異なり依存関係グラフ (blockedBy) が Actio コア tasks には
 * 無いため isReady は常に true (H1「依存関係/milestone は必要時に再設計相談」で明示的に据え置き)。
 */
export function buildProjectHubCandidates(
  tasks: ProjectHubSprintTask[],
  estimates: Array<{ taskRef: string; effortMinutes: number }>,
  priorities: Array<{ ref: string; resolvedScore: number }>,
): CandidateBuildResult {
  const estimatesByRef = new Map(estimates.map((row) => [row.taskRef, row.effortMinutes]));
  const prioritiesByRef = new Map(priorities.map((row) => [row.ref, row.resolvedScore]));
  const missingEstimates: string[] = [];
  const missingPriorities: string[] = [];
  const candidates: SprintTaskCandidate[] = [];
  for (const task of tasks) {
    if (isCompletedStatus(task.sourceStatus) || task.isHumanGate) continue;
    const effortMinutes = task.declaredEffortMinutes ?? estimatesByRef.get(task.taskRef) ?? null;
    if (effortMinutes === null || effortMinutes <= 0) {
      missingEstimates.push(task.taskRef);
      continue;
    }
    const priority = prioritiesByRef.get(task.taskRef);
    if (priority === undefined) missingPriorities.push(task.taskRef);
    candidates.push({
      taskRef: task.taskRef,
      sourceId: task.sourceId,
      sourceStatus: task.sourceStatus,
      labels: task.labels,
      createdAt: task.createdAt,
      effortMinutes,
      priority: priority ?? 0,
      isReady: true,
    });
  }
  return { candidates, missingEstimates, missingPriorities };
}
