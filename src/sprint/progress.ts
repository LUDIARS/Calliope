// PROJECTHUB scope (`projecthub:<project_id>`) の PJ 別進捗レポート合成。
// docs/design/projecthub-pm.md H4: GET /api/projecthub/progress は sprint health / burndown / risk /
// 停滞タスクを on-demand に合成する (保存しない)。 sprint/projecthub-engine.ts の replanProjectHub と
// 計算式の骨格は共通だが、 replanProjectHub は repo への書込 (recordSprintTaskStates /
// upsertCurveSnapshot) を伴う「replan 操作」であるのに対し、 こちらは読み取り専用の
// レポート合成であり DB には一切書かない (このファイルの純粋関数は I/O を持たない)。

import { isCompletedStatus } from '../planning/tasks.ts';
import { evaluateGoalRisk, type RiskLevel } from '../risk/score.ts';
import { estimateP80Factor, parseVelocityDistribution } from '../velocity/distribution.ts';
import type { ProjectHubSprintTask } from './candidates.ts';
import { average, daysBetween, MS_PER_DAY } from './util.ts';

const STALLED_THRESHOLD_DAYS = 3;

export interface ProgressSprintTask {
  taskRef: string;
  effortMinutes: number;
  priorityScore: number;
  status: 'committed' | 'completed' | 'removed';
  committedAt: string;
}

export interface ProgressSprint {
  id: string;
  status: 'planned' | 'active' | 'closed';
  goalRef: string | null;
  periodStart: string;
  periodEnd: string;
  tasks: ProgressSprintTask[];
}

export interface ProgressVelocity {
  throughput: number;
  kFactor: number;
  distribution: unknown;
  sampleSize: number;
  source?: string;
}

export interface GoalEvalLike {
  status: 'todo' | 'doing' | 'done';
}

export interface ProjectHubProgressInput {
  now: Date;
  project: { rawId: string; projectRef: string; name: string };
  sprint: ProgressSprint | null;
  /** PROJECTHUB プロジェクト全体の現在の Actio コアタスク一覧 (sprint コミット有無に関わらず全件)。 */
  currentTasks: ProjectHubSprintTask[];
  velocity: ProgressVelocity | null;
  /** sprint.goalRef が指す goal タスクの deadline (無ければ null → periodEnd で代替)。 */
  goalDeadline: string | null;
  latestGoalEval: GoalEvalLike | null;
}

export interface StalledTask {
  taskRef: string;
  sourceStatus: string;
  committedAt: string;
  stalledDays: number;
}

export interface ProjectHubProjectProgress {
  projectId: string;
  projectRef: string;
  projectName: string;
  sprint: { id: string; status: string; periodStart: string; periodEnd: string } | null;
  health: {
    status: 'no_sprint' | 'complete' | 'on_track' | 'at_risk';
    projectedCompletion: string | null;
    scopeCreepRate: number;
    velocitySpread: number;
    goalProgress: {
      source: 'memoria_goal_eval' | 'actio_completion_fallback';
      status: 'todo' | 'doing' | 'done' | null;
      observed: number;
      expected: number;
      lag: number;
    } | null;
  };
  burndown: {
    committedMinutes: number;
    remainingMinutes: number;
    plannedRemainingMinutes: number;
    elapsedFraction: number;
  } | null;
  risk: { level: RiskLevel; projectedCompletion: string; deadline: string; slackDaysP50: number; slackDaysP80: number } | null;
  stalledTasks: StalledTask[];
  warnings: string[];
}

function goalProgressFromStatus(status: 'todo' | 'doing' | 'done'): number {
  if (status === 'done') return 1;
  if (status === 'doing') return 0.5;
  return 0;
}

export function composeProjectHubProjectProgress(input: ProjectHubProgressInput): ProjectHubProjectProgress {
  const base = { projectId: input.project.rawId, projectRef: input.project.projectRef, projectName: input.project.name };
  if (!input.sprint) {
    return {
      ...base,
      sprint: null,
      health: {
        status: 'no_sprint', projectedCompletion: null, scopeCreepRate: 0, velocitySpread: 1, goalProgress: null,
      },
      burndown: null,
      risk: null,
      stalledTasks: [],
      warnings: ['no_sprint_for_project: design a sprint via POST /api/sprint to get a progress view'],
    };
  }

  const { sprint, now } = input;
  const warnings: string[] = [
    'gompertz_degraded: projecthub scope has no bug curve data; capacity uses inflow-reservation only',
  ];
  const currentByRef = new Map(input.currentTasks.map((task) => [task.taskRef, task]));
  // replanProjectHub と同じ照合ロジックだが、ここでは repo への書込 (recordSprintTaskStates) を
  // 行わない — 進捗レポートは on-demand 合成であり保存しない (H4 完了条件)。
  const transientStatus = new Map(sprint.tasks.map((committed) => {
    const current = currentByRef.get(committed.taskRef);
    const status = current === undefined ? 'removed' as const :
      isCompletedStatus(current.sourceStatus) ? 'completed' as const :
      committed.status === 'removed' ? 'removed' as const : 'committed' as const;
    return [committed.taskRef, status] as const;
  }));

  const remainingTasks = sprint.tasks.filter((task) => transientStatus.get(task.taskRef) === 'committed');
  const actualRemaining = remainingTasks.reduce((sum, task) => sum + task.effortMinutes, 0);
  const totalCommitted = sprint.tasks.reduce((sum, task) => sum + task.effortMinutes, 0);
  const periodStart = new Date(sprint.periodStart);
  const periodEnd = new Date(sprint.periodEnd);
  const totalDays = Math.max(daysBetween(periodStart, periodEnd), 1);
  const elapsedFraction = Math.min(daysBetween(periodStart, now) / totalDays, 1);
  const plannedRemaining = totalCommitted * (1 - elapsedFraction);
  const burndown = {
    committedMinutes: totalCommitted,
    remainingMinutes: actualRemaining,
    plannedRemainingMinutes: plannedRemaining,
    elapsedFraction,
  };

  if (!input.velocity || input.velocity.throughput <= 0) {
    warnings.push('velocity_unavailable: sprint health/risk cannot be projected');
    return {
      ...base,
      sprint: { id: sprint.id, status: sprint.status, periodStart: sprint.periodStart, periodEnd: sprint.periodEnd },
      health: { status: 'at_risk', projectedCompletion: null, scopeCreepRate: 0, velocitySpread: 1, goalProgress: null },
      burndown,
      risk: null,
      stalledTasks: [],
      warnings,
    };
  }
  if (input.velocity.sampleSize === 0) {
    warnings.push(`velocity_cold_start: using declared backlog capacity for ${input.project.projectRef}`);
  }

  const remainingDays = Math.max(daysBetween(now, periodEnd), 1 / 24);
  const averageEffortMinutes = average(sprint.tasks.map((task) => task.effortMinutes));
  const effectiveCapacityMinutes = input.velocity.throughput * Math.max(Math.ceil(remainingDays), 1);
  const effectiveThroughput = effectiveCapacityMinutes / Math.max(Math.ceil(remainingDays), 1);
  const projectedDays = actualRemaining === 0 ? 0 :
    effectiveThroughput > 0 ? actualRemaining / effectiveThroughput : Number.POSITIVE_INFINITY;
  const projectedCompletion = Number.isFinite(projectedDays)
    ? new Date(now.getTime() + projectedDays * MS_PER_DAY).toISOString()
    : null;
  const isDelayed = projectedCompletion === null || new Date(projectedCompletion) > periodEnd;
  const committedRefs = new Set(sprint.tasks.map((task) => task.taskRef));
  const scopeCreepCount = input.currentTasks.filter((task) =>
    !committedRefs.has(task.taskRef) && new Date(task.createdAt) >= periodStart).length;
  const scopeCreepRate = scopeCreepCount / Math.max(sprint.tasks.length, 1);
  const distribution = parseVelocityDistribution(input.velocity.distribution);
  const velocitySpread = distribution && distribution.p50 > 0
    ? (distribution.p75 - distribution.p25) / distribution.p50
    : 1;

  const completionProgress = totalCommitted > 0 ? 1 - actualRemaining / totalCommitted : 1;
  const goalProgress = input.latestGoalEval ? {
    source: 'memoria_goal_eval' as const,
    status: input.latestGoalEval.status,
    observed: goalProgressFromStatus(input.latestGoalEval.status),
    expected: elapsedFraction,
    lag: Math.max(elapsedFraction - goalProgressFromStatus(input.latestGoalEval.status), 0),
  } : {
    source: 'actio_completion_fallback' as const,
    status: null,
    observed: completionProgress,
    expected: elapsedFraction,
    lag: Math.max(elapsedFraction - completionProgress, 0),
  };
  if (!input.latestGoalEval) warnings.push('goal_eval_unavailable: Actio completion ratio used for sprint health');
  const isGoalProgressLate = goalProgress.lag > 0.25;

  const health = {
    status: actualRemaining === 0 ? 'complete' as const : isDelayed || isGoalProgressLate ? 'at_risk' as const : 'on_track' as const,
    projectedCompletion,
    scopeCreepRate,
    velocitySpread,
    goalProgress,
  };

  const deadline = input.goalDeadline ?? sprint.periodEnd;
  const p50Factor = Math.max(input.velocity.kFactor, 0);
  const p80Factor = Math.max(estimateP80Factor(input.velocity.distribution, p50Factor), p50Factor);
  const criticalPathDays = actualRemaining > 0 ? actualRemaining / input.velocity.throughput : 0;
  const riskScore = evaluateGoalRisk({ now, deadline, criticalPathDays, p50Factor, p80Factor });
  const risk = {
    level: riskScore.level,
    projectedCompletion: riskScore.projectedCompletion,
    deadline: riskScore.deadline,
    slackDaysP50: riskScore.slackDaysP50,
    slackDaysP80: riskScore.slackDaysP80,
  };

  const stalledTasks: StalledTask[] = remainingTasks.flatMap((task) => {
    const current = currentByRef.get(task.taskRef);
    if (!current || current.sourceStatus !== 'open') return [];
    const stalledDays = daysBetween(new Date(task.committedAt), now);
    if (stalledDays < STALLED_THRESHOLD_DAYS) return [];
    return [{ taskRef: task.taskRef, sourceStatus: current.sourceStatus, committedAt: task.committedAt, stalledDays }];
  });

  return {
    ...base,
    sprint: { id: sprint.id, status: sprint.status, periodStart: sprint.periodStart, periodEnd: sprint.periodEnd },
    health,
    burndown,
    risk,
    stalledTasks,
    warnings,
  };
}
