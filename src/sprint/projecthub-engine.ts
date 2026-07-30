// PROJECTHUB scope (`projecthub:<project_id>`) 用のスプリント設計/replan。
// docs/design/projecthub-pm.md H4 の実装。 能力C (sprint 設計/replan/close) を学生 PJ に適用する。
//
// Actio PM project 版 (engine.ts の designPm/replanPm) とロジックの骨格は同じだが、入力ソースが
// 異なる (Gompertz バグ収束・critical path・タスク履歴 API が無い) ため縮退モードで動く。
// H1-3 最終裁定: 学生 PJ への書込系 (タスク生成・リスケ適用) は auto-apply 禁止・confirmation
// 経由のみ。 このファイルは Actio/PROJECTHUB へは一切書き込まない (Calliope 自身の sprint/curve
// レコードのみを書く) — 返す proposals はあくまで提案であり、適用は行わない。

import { randomUUID } from 'node:crypto';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { buildProjectHubCandidates } from './candidates.ts';
import { calculateSprintCapacity } from './capacity.ts';
import { SprintPrerequisiteError } from './errors.ts';
import { degradedBugReserve, loadProjectHubInflow, loadProjectHubSprintTasks } from './projecthub-tasks.ts';
import { calculateProjectHubVelocityFallback, type ProjectHubVelocityFallback } from './projecthub-velocity.ts';
import type { ProjectHubProjectHandle } from './project.ts';
import { isCompletedStatus } from '../planning/tasks.ts';
import { parseTaskRef } from '../refs.ts';
import { parseVelocityDistribution } from '../velocity/distribution.ts';
import { average, daysBetween, goalProgressFromStatus, MS_PER_DAY } from './util.ts';

export interface ProjectHubSprintDeps {
  clients: CalliopeClients;
  repo: CalliopeRepository;
  agentLanes: number;
  now?: () => Date;
  id?: () => string;
}

interface StoredVelocityRow {
  projectRef: string;
  category: string;
  throughput: number;
  kFactor: number;
  distribution: unknown;
  sampleSize: number;
  source?: string;
}

function findStoredVelocity(rows: StoredVelocityRow[], projectRef: string): StoredVelocityRow | null {
  return rows.find((row) => row.projectRef === projectRef && row.category === '*') ?? null;
}

const GOMPERTZ_DEGRADED_WARNING =
  'gompertz_degraded: projecthub scope has no bug curve data; bug reserve is zero (inflow-reservation-only mode)';
const INFLOW_DEGRADED_WARNING =
  'projecthub_scope_task_history_unavailable: inflow computed from task.createdAt only';

export async function designProjectHub(
  deps: ProjectHubSprintDeps,
  handle: ProjectHubProjectHandle,
  input: { goalRef?: string; sprintDays: number },
  now: Date,
) {
  const { sprintDays } = input;
  const [tasks, estimates, priorities, storedVelocities] = await Promise.all([
    loadProjectHubSprintTasks(handle.actio, handle.rawId),
    deps.repo.listTaskEstimates(),
    deps.repo.listPriorities({ scope: 'task' }),
    deps.repo.listLatestVelocity(),
  ]);
  const velocity: ProjectHubVelocityFallback | StoredVelocityRow =
    findStoredVelocity(storedVelocities, handle.projectRef) ??
    calculateProjectHubVelocityFallback(handle.projectRef, tasks, now);
  const missing: string[] = [];
  if (!velocity || velocity.throughput <= 0) missing.push('velocity');
  if (estimates.length === 0 && tasks.every((task) => task.declaredEffortMinutes === null)) missing.push('estimates');
  if (priorities.length === 0) missing.push('priority');
  if (missing.length > 0) throw new SprintPrerequisiteError(missing);

  const built = buildProjectHubCandidates(tasks, estimates, priorities);
  const allEffortByRef = new Map<string, number>();
  for (const task of tasks) {
    const stored = estimates.find((row) => row.taskRef === task.taskRef)?.effortMinutes;
    const effort = task.declaredEffortMinutes ?? stored;
    if (effort !== undefined && effort > 0) allEffortByRef.set(task.taskRef, effort);
  }
  const inflow = await loadProjectHubInflow(tasks, allEffortByRef, now);
  const bugReserve = degradedBugReserve();

  const warnings: string[] = [GOMPERTZ_DEGRADED_WARNING, INFLOW_DEGRADED_WARNING];
  if (built.missingEstimates.length > 0) warnings.push(`${built.missingEstimates.length} unestimated task(s) excluded`);
  if (built.missingPriorities.length > 0) warnings.push(`${built.missingPriorities.length} task(s) use explicit priority score 0`);
  if (velocity.sampleSize === 0) warnings.push(`velocity_cold_start: using declared backlog capacity for ${handle.projectRef}`);

  if (inflow.lambda > 0 && inflow.averageEffortMinutes <= 0) {
    throw new SprintPrerequisiteError(['inflow_effort']);
  }

  const capacity = calculateSprintCapacity({
    sprintDays,
    throughputPerDay: velocity.throughput,
    remainingBugCount: bugReserve.remainingBugCount,
    averageBugEffortMinutes: bugReserve.averageBugEffortMinutes,
    inflowLambda: inflow.lambda,
    averageInflowEffortMinutes: inflow.averageEffortMinutes,
    tasks: built.candidates,
  });
  if (capacity.isReserveOverCapacity) warnings.push('inflow reserve consumes the full sprint capacity');

  const sprintId = (deps.id ?? randomUUID)();
  const periodEnd = new Date(now.getTime() + sprintDays * MS_PER_DAY);
  const gompertzSnapshot = {
    report: bugReserve.snapshot,
    inflow,
    velocity: { source: velocity.source ?? 'stored', sampleSize: velocity.sampleSize },
    capacity: {
      rawCapacityMinutes: capacity.rawCapacityMinutes,
      bugReserveMinutes: capacity.bugReserveMinutes,
      inflowReserveMinutes: capacity.inflowReserveMinutes,
      effectiveCapacityMinutes: capacity.effectiveCapacityMinutes,
      committedMinutes: capacity.committedMinutes,
    },
  };
  const candidateByRef = new Map(built.candidates.map((task) => [task.taskRef, task]));
  await deps.repo.createSprintWithTasks({
    id: sprintId,
    projectRef: handle.projectRef,
    goalRef: input.goalRef ?? null,
    periodStart: now.toISOString(),
    periodEnd: periodEnd.toISOString(),
    targetVelocity: velocity.throughput,
    gompertzSnapshot,
    status: 'planned',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }, capacity.selected.map((task) => ({
    id: (deps.id ?? randomUUID)(),
    sprintId,
    taskRef: task.taskRef,
    effortMinutes: task.effortMinutes,
    priorityScore: task.priority,
    status: 'committed',
    statusHistory: [{
      at: now.toISOString(),
      status: 'committed',
      sourceStatus: candidateByRef.get(task.taskRef)?.sourceStatus ?? 'unknown',
    }],
    committedAt: now.toISOString(),
  })));
  await deps.repo.upsertCurveSnapshot({
    id: (deps.id ?? randomUUID)(),
    sprintId,
    date: now.toISOString().slice(0, 10),
    gompertzParams: gompertzSnapshot,
    inflowLambda: inflow.lambda,
    burndownActual: capacity.committedMinutes,
    burndownPlanned: capacity.committedMinutes,
    createdAt: now.toISOString(),
  });
  return {
    sprint: await deps.repo.getSprintWithTasks(sprintId),
    capacity,
    excluded: {
      unestimated: built.missingEstimates,
      blockedOrCapacity: capacity.excluded,
    },
    warnings,
  };
}

export async function replanProjectHub(
  deps: ProjectHubSprintDeps,
  handle: ProjectHubProjectHandle,
  existing: NonNullable<Awaited<ReturnType<CalliopeRepository['getSprintWithTasks']>>>,
) {
  const sprintId = existing.id;
  const now = deps.now?.() ?? new Date();
  const [tasks, estimates, priorities, storedVelocities, goalEvals] = await Promise.all([
    loadProjectHubSprintTasks(handle.actio, handle.rawId),
    deps.repo.listTaskEstimates(),
    deps.repo.listPriorities({ scope: 'task' }),
    deps.repo.listLatestVelocity(),
    deps.clients.memoria
      ? deps.clients.memoria.getGoalEvals(now.toISOString().slice(0, 7))
      : Promise.resolve(null),
  ]);
  const velocity: ProjectHubVelocityFallback | StoredVelocityRow =
    findStoredVelocity(storedVelocities, handle.projectRef) ??
    calculateProjectHubVelocityFallback(handle.projectRef, tasks, now);
  if (!velocity || velocity.throughput <= 0) throw new SprintPrerequisiteError(['velocity']);

  const built = buildProjectHubCandidates(tasks, estimates, priorities);
  const currentByRef = new Map(tasks.map((task) => [task.taskRef, task]));
  const states = existing.tasks.map((committed) => {
    const current = currentByRef.get(committed.taskRef);
    return {
      taskRef: committed.taskRef,
      status: current === undefined ? 'removed' as const :
        isCompletedStatus(current.sourceStatus) ? 'completed' as const : 'committed' as const,
      sourceStatus: current?.sourceStatus ?? 'missing',
    };
  });
  await deps.repo.recordSprintTaskStates(sprintId, states, now.toISOString());

  const stateByRef = new Map(states.map((state) => [state.taskRef, state.status]));
  const remainingTasks = existing.tasks.filter((task) => stateByRef.get(task.taskRef) === 'committed');
  const actualRemaining = remainingTasks.reduce((sum, task) => sum + task.effortMinutes, 0);
  const totalCommitted = existing.tasks.reduce((sum, task) => sum + task.effortMinutes, 0);
  const periodStart = new Date(existing.periodStart);
  const periodEnd = new Date(existing.periodEnd);
  const totalDays = Math.max(daysBetween(periodStart, periodEnd), 1);
  const elapsedFraction = Math.min(daysBetween(periodStart, now) / totalDays, 1);
  const plannedRemaining = totalCommitted * (1 - elapsedFraction);

  const effortByRef = new Map(existing.tasks.map((task) => [task.taskRef, task.effortMinutes]));
  const inflow = await loadProjectHubInflow(tasks, effortByRef, now);
  const remainingDays = Math.max(daysBetween(now, periodEnd), 1 / 24);
  const averageEffortMinutes = average(existing.tasks.map((task) => task.effortMinutes));
  const capacity = calculateSprintCapacity({
    sprintDays: Math.max(Math.ceil(remainingDays), 1),
    throughputPerDay: velocity.throughput,
    remainingBugCount: 0,
    averageBugEffortMinutes: 0,
    inflowLambda: inflow.lambda,
    averageInflowEffortMinutes: inflow.averageEffortMinutes || averageEffortMinutes,
    tasks: [],
  });
  const effectiveThroughput = capacity.effectiveCapacityMinutes / Math.max(Math.ceil(remainingDays), 1);
  const projectedDays = actualRemaining === 0 ? 0 :
    effectiveThroughput > 0 ? actualRemaining / effectiveThroughput : Number.POSITIVE_INFINITY;
  const projectedCompletion = Number.isFinite(projectedDays)
    ? new Date(now.getTime() + projectedDays * MS_PER_DAY).toISOString()
    : null;
  const isDelayed = projectedCompletion === null || new Date(projectedCompletion) > periodEnd;
  const committedRefs = new Set(existing.tasks.map((task) => task.taskRef));
  const scopeCreepCount = tasks.filter((task) =>
    !committedRefs.has(task.taskRef) && new Date(task.createdAt) >= periodStart).length;
  const scopeCreepRate = scopeCreepCount / Math.max(existing.tasks.length, 1);
  const distribution = parseVelocityDistribution(velocity.distribution);
  const velocitySpread = distribution && distribution.p50 > 0
    ? (distribution.p75 - distribution.p25) / distribution.p50
    : 1;
  const parsedGoal = existing.goalRef ? parseTaskRef(existing.goalRef) : null;
  const goalSourceId = parsedGoal?.source === 'actio' ? parsedGoal.taskId : null;
  const latestGoalEval = goalEvals
    ?.filter((item) => item.goal_id === goalSourceId)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const completionProgress = totalCommitted > 0 ? 1 - actualRemaining / totalCommitted : 1;
  const goalProgress = latestGoalEval ? {
    source: 'memoria_goal_eval' as const,
    status: latestGoalEval.status,
    observed: goalProgressFromStatus(latestGoalEval.status),
    expected: elapsedFraction,
    lag: Math.max(elapsedFraction - goalProgressFromStatus(latestGoalEval.status), 0),
  } : {
    source: 'actio_completion_fallback' as const,
    status: null,
    observed: completionProgress,
    expected: elapsedFraction,
    lag: Math.max(elapsedFraction - completionProgress, 0),
  };
  const isGoalProgressLate = goalProgress.lag > 0.25;
  const scopeReduction: string[] = [];
  if (isDelayed || isGoalProgressLate) {
    let remaining = actualRemaining;
    for (const task of [...remainingTasks].sort((a, b) => a.priorityScore - b.priorityScore)) {
      if (remaining <= capacity.effectiveCapacityMinutes) break;
      scopeReduction.push(task.taskRef);
      remaining -= task.effortMinutes;
    }
  }
  const extensionDays = Number.isFinite(projectedDays)
    ? Math.max(Math.ceil(projectedDays - remainingDays), 0)
    : null;
  const requiredThroughputPerDay = remainingDays > 0
    ? (actualRemaining + capacity.bugReserveMinutes + capacity.inflowReserveMinutes) / remainingDays
    : null;
  const requiredLanes = requiredThroughputPerDay === null
    ? null
    : Math.max(Math.ceil((requiredThroughputPerDay / velocity.throughput) * deps.agentLanes), deps.agentLanes);
  const pullIn: string[] = [];
  if (!isDelayed && !isGoalProgressLate) {
    let room = Math.max(capacity.effectiveCapacityMinutes - actualRemaining, 0);
    for (const task of built.candidates.filter((task) => !committedRefs.has(task.taskRef) && task.isReady)
      .sort((a, b) => b.priority - a.priority)) {
      if (task.effortMinutes > room) continue;
      pullIn.push(task.taskRef);
      room -= task.effortMinutes;
    }
  }
  const health = {
    status: actualRemaining === 0 ? 'complete' : isDelayed || isGoalProgressLate ? 'at_risk' : 'on_track',
    projectedCompletion,
    scopeCreepRate,
    velocitySpread,
    gompertzConfidence: 0,
    goalProgress,
  };
  // H1-3 最終裁定: 学生 PJ への書込系 (リスケ適用) は auto-apply 禁止。
  // ここで返す proposals は提案に留まり、Calliope はこれを Actio/PROJECTHUB に書き戻さない
  // (書込を行う場合は既存の confirmation フロー経由のみ — このタスクでは書込パス自体を追加しない)。
  const proposals = isDelayed || isGoalProgressLate ? {
    scopeReduction,
    extensionDays,
    requiredThroughputPerDay,
    additionalLanes: requiredLanes === null ? null : Math.max(requiredLanes - deps.agentLanes, 0),
    pullIn: [],
  } : {
    scopeReduction: [],
    extensionDays: 0,
    requiredThroughputPerDay,
    additionalLanes: 0,
    pullIn,
  };
  await deps.repo.upsertCurveSnapshot({
    id: (deps.id ?? randomUUID)(),
    sprintId,
    date: now.toISOString().slice(0, 10),
    gompertzParams: { report: degradedBugReserve().snapshot, health, proposals },
    inflowLambda: inflow.lambda,
    burndownActual: actualRemaining,
    burndownPlanned: plannedRemaining,
    createdAt: now.toISOString(),
  });
  return {
    sprint: await deps.repo.getSprintWithTasks(sprintId),
    health,
    proposals,
    warnings: [
      GOMPERTZ_DEGRADED_WARNING,
      INFLOW_DEGRADED_WARNING,
      ...(!latestGoalEval ? ['goal_eval_unavailable: Actio completion ratio used for sprint health'] : []),
      ...(velocity.sampleSize === 0 ? [`velocity_cold_start: using declared backlog capacity for ${handle.projectRef}`] : []),
    ],
  };
}
