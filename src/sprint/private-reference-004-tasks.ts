// <private-reference-004> scope (`<private-reference-004>:<project_id>`) のスプリント入力読み出し。
// docs/design/<private-reference-004>-pm.md H4: Gompertz バグ収束の初期データが無い学生 PJ では
// 流入予約のみの縮退モードで sprint を設計できる (縮退は明示ログ + レポート表記、
// 無言フォールバック禁止)。 タスク完了履歴 API (Actio PM 専用) も無いため、
// inflow の生成時刻は task.createdAt をそのまま使う (これも縮退として明示する)。

import type { ActioClient } from '../clients/actio.ts';
import type { ActioTask } from '../clients/contracts.ts';
import { calculateInflow, type InflowEvent } from './inflow.ts';
import type { <private-reference-004>SprintTask } from './candidates.ts';
import { makeTaskRef } from '../refs.ts';

/** 純粋な変換部分。 progress-engine.ts のように Actio tasks を一括取得して複数プロジェクトへ
 *  振り分けたい呼び出し元は、 このヘルパーを直接使えば listTasks() を使い回せる。 */
export function to<private-reference-004>SprintTasks(tasks: ActioTask[], <private-reference-004>ProjectId: string): <private-reference-004>SprintTask[] {
  return tasks
    .filter((task) => task.projectId === <private-reference-004>ProjectId)
    .map((task): <private-reference-004>SprintTask => ({
      taskRef: makeTaskRef('actio', task.id),
      sourceId: task.id,
      sourceStatus: task.status,
      labels: task.category?.trim() ? [task.category.trim()] : [],
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      declaredEffortMinutes: task.estimatedMinutes,
      isHumanGate: task.kind === 'goal',
    }));
}

export async function load<private-reference-004>SprintTasks(actio: ActioClient, <private-reference-004>ProjectId: string): Promise<<private-reference-004>SprintTask[]> {
  const tasks = await actio.listTasks();
  return to<private-reference-004>SprintTasks(tasks, <private-reference-004>ProjectId);
}

export interface DegradedBugReserve {
  remainingBugCount: number;
  averageBugEffortMinutes: number;
  confidenceLevel: number;
  snapshot: { degraded: true; reason: string };
}

/**
 * <private-reference-004> scope には Actio PM の Gompertz バグ収束エンドポイントが存在しない
 * (学生タスクは PM プロジェクトではなく Actio コア tasks.project_id 紐付けのため)。
 * バグ予約をゼロにし、流入予約のみの縮退モードで容量計算する。
 */
export function degradedBugReserve(): DegradedBugReserve {
  return {
    remainingBugCount: 0,
    averageBugEffortMinutes: 0,
    confidenceLevel: 0,
    snapshot: { degraded: true, reason: '<private-reference-004>_scope_no_bug_curve_data' },
  };
}

export async function load<private-reference-004>Inflow(
  tasks: <private-reference-004>SprintTask[],
  effortByRef: Map<string, number>,
  now: Date,
) {
  const events: InflowEvent[] = tasks.map((task) => ({
    taskRef: task.taskRef,
    createdAt: task.createdAt,
    effortMinutes: effortByRef.get(task.taskRef) ?? null,
  }));
  return { ...calculateInflow(events, { now }), degraded: true as const };
}
