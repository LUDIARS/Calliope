// <private-reference-004> scope (学生 PJ) の velocity 代替算出。
//
// docs/design/<private-reference-004>-pm.md H1 最終裁定 (2026-07-17, 2): 学生 PJ の velocity は Memoria
// agent_runs (AI 実行実績) 基準の既存 velocity エンジン (src/velocity/engine.ts) の対象外
// (creatorType !== 'ai' は samples から除外される — 人間のタスクには「実行時間」の実績が無い)。
// 裁定: velocity = 完了実績 Θ_p 週次rolling、k_p は非適用 (k=1 固定) + 広信頼帯、
// cold-start (直近ウィンドウに完了実績が無い) は申告合計容量 (未完了バックログの申告工数合計) を使う。
//
// このファイルは sprint 設計/replan が必要とする最小限を on-demand に算出する純粋関数。
// 永続化はしない (src/velocity/ のテーブルには書かない — 本タスクのスコープ外)。
// 将来 src/velocity/ 側に恒久実装する場合はこの関数を置き換える想定。

import { isCompletedStatus } from '../planning/tasks.ts';
import type { <private-reference-004>SprintTask } from './candidates.ts';

const WINDOW_DAYS = 28;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// k=1 (非適用) を中心に意図的に広く取った信頼帯 (velocityConfidence の spread ペナルティで
// 「暫定表示」を表現する — src/velocity/distribution.ts 参照)。
const WIDE_DISTRIBUTION = { p25: 0.5, p50: 1, p75: 1.5 };

export interface <private-reference-004>VelocityFallback {
  projectRef: string;
  category: '*';
  kFactor: 1;
  throughput: number;
  distribution: typeof WIDE_DISTRIBUTION;
  sampleSize: number;
  source: '<private-reference-004>_completed_throughput' | '<private-reference-004>_cold_start_capacity';
}

function sumEffort(tasks: <private-reference-004>SprintTask[]): number {
  return tasks
    .map((task) => task.declaredEffortMinutes)
    .filter((minutes): minutes is number => minutes !== null && minutes > 0)
    .reduce((sum, minutes) => sum + minutes, 0);
}

export function calculate<private-reference-004>VelocityFallback(
  projectRef: string,
  tasks: <private-reference-004>SprintTask[],
  now: Date,
): <private-reference-004>VelocityFallback {
  const windowStartMs = now.getTime() - WINDOW_DAYS * MS_PER_DAY;
  const completedInWindow = tasks.filter((task) => {
    if (!isCompletedStatus(task.sourceStatus) || !task.completedAt) return false;
    const completedMs = new Date(task.completedAt).getTime();
    return Number.isFinite(completedMs) && completedMs >= windowStartMs && completedMs <= now.getTime();
  });
  const completedEffort = sumEffort(completedInWindow);
  if (completedEffort > 0) {
    return {
      projectRef,
      category: '*',
      kFactor: 1,
      throughput: completedEffort / WINDOW_DAYS,
      distribution: WIDE_DISTRIBUTION,
      sampleSize: completedInWindow.length,
      source: '<private-reference-004>_completed_throughput',
    };
  }

  // cold-start: 直近ウィンドウに完了実績が無い。申告総容量 (未完了バックログの申告工数合計) を使う。
  const openCapacity = sumEffort(
    tasks.filter((task) => !isCompletedStatus(task.sourceStatus) && !task.isHumanGate),
  );
  return {
    projectRef,
    category: '*',
    kFactor: 1,
    throughput: openCapacity / WINDOW_DAYS,
    distribution: WIDE_DISTRIBUTION,
    sampleSize: 0,
    source: '<private-reference-004>_cold_start_capacity',
  };
}
