import { randomUUID } from 'node:crypto';
import type { PmTask, PmTaskSnapshot } from '../clients/contracts.ts';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { isCompletedStatus } from '../planning/tasks.ts';
import { parseTaskRef } from '../refs.ts';
import { parseVelocityDistribution } from '../velocity/distribution.ts';
import { buildCandidates, taskRefForPmTask as taskRef } from './candidates.ts';
import { calculateSprintCapacity } from './capacity.ts';
import { SprintPrerequisiteError } from './errors.ts';
import { design<private-reference-004>, replan<private-reference-004> } from './<private-reference-004>-engine.ts';
import { calculateInflow, type InflowEvent } from './inflow.ts';
import { resolveSprintProject } from './project.ts';
import { average, daysBetween, DEFAULT_SPRINT_DAYS, goalProgressFromStatus, MS_PER_DAY } from './util.ts';

export { SprintPrerequisiteError } from './errors.ts';

export interface SprintEngineDeps {
  clients: CalliopeClients;
  repo: CalliopeRepository;
  agentLanes: number;
  now?: () => Date;
  id?: () => string;
}

function findVelocity(
  rows: Array<{ projectRef: string; category: string; throughput: number; kFactor: number; distribution: unknown; sampleSize: number }>,
  projectId: string,
  projectName: string,
) {
  return rows.find((row) => row.projectRef === projectId && row.category === '*') ??
    rows.find((row) => row.projectRef === projectName && row.category === '*') ??
    rows.find((row) => row.projectRef === projectId) ??
    rows.find((row) => row.projectRef === projectName) ??
    rows.find((row) => row.projectRef === '*' && row.category === '*') ??
    null;
}

function createdAtFromHistory(task: PmTask, history: PmTaskSnapshot[]): { createdAt: string; usedFallback: boolean } {
  const created = history
    .filter((snapshot) => snapshot.changeType === 'created')
    .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt))[0];
  return created
    ? { createdAt: created.detectedAt, usedFallback: false }
    : { createdAt: task.createdAt, usedFallback: true };
}

async function loadInflow(
  actio: NonNullable<CalliopeClients['actio']>,
  projectId: string,
  tasks: PmTask[],
  effortByRef: Map<string, number>,
  now: Date,
) {
  const histories = await Promise.all(tasks.map(async (task) => ({
    task,
    history: await actio.listPmTaskHistory(task.id),
  })));
  let fallbackCount = 0;
  const events: InflowEvent[] = histories.map(({ task, history }) => {
    const created = createdAtFromHistory(task, history);
    if (created.usedFallback) fallbackCount++;
    return {
      taskRef: taskRef(projectId, task),
      createdAt: created.createdAt,
      effortMinutes: effortByRef.get(taskRef(projectId, task)) ?? null,
    };
  });
  return { ...calculateInflow(events, { now }), fallbackCount };
}

export function makeSprintEngine(deps: SprintEngineDeps) {
  async function designPm(project: { id: string; name: string }, input: { goalRef?: string; sprintDays: number }, now: Date) {
    const actio = deps.clients.actio;
    if (!actio) throw new SprintPrerequisiteError(['actio']);
    const { sprintDays } = input;
    const [tasks, gompertz, estimates, priorities, velocities] = await Promise.all([
      actio.listPmTasks(project.id),
      actio.getGompertz(project.id),
      deps.repo.listTaskEstimates(),
      deps.repo.listPriorities({ scope: 'task' }),
      deps.repo.listLatestVelocity(),
    ]);
    const velocity = findVelocity(velocities, project.id, project.name);
    const missing: string[] = [];
    if (!velocity || velocity.throughput <= 0) missing.push('velocity');
    if (estimates.length === 0 && tasks.every((task) => task.estimatedHours === null)) missing.push('estimates');
    if (priorities.length === 0) missing.push('priority');
    if (missing.length > 0) throw new SprintPrerequisiteError(missing);

    const built = buildCandidates(project.id, tasks, estimates, priorities);
    const allEffortByRef = new Map<string, number>();
    for (const task of tasks) {
      const ref = taskRef(project.id, task);
      const stored = estimates.find((row) => row.taskRef === ref)?.effortMinutes;
      const effort = task.estimatedHours === null ? stored : task.estimatedHours * 60;
      if (effort !== undefined && effort > 0) allEffortByRef.set(ref, effort);
    }
    const inflow = await loadInflow(actio, project.id, tasks, allEffortByRef, now);
    const allEfforts = [...allEffortByRef.values()];
    const bugEfforts = tasks
      .filter((task) => task.labels.some((label) => label.toLowerCase().includes('bug')))
      .map((task) => allEffortByRef.get(taskRef(project.id, task)))
      .filter((effort): effort is number => effort !== undefined);
    const warnings: string[] = [];
    if (inflow.fallbackCount > 0) {
      warnings.push(`inflow_history_incomplete: used task.createdAt for ${inflow.fallbackCount} task(s)`);
    }
    if (built.missingEstimates.length > 0) {
      warnings.push(`${built.missingEstimates.length} unestimated task(s) excluded`);
    }
    if (built.missingPriorities.length > 0) {
      warnings.push(`${built.missingPriorities.length} task(s) use explicit priority score 0`);
    }
    if (gompertz.confidenceLevel === 0) warnings.push('gompertz confidence is zero: bug reserve is provisional');
    const averageEffortMinutes = average(allEfforts);
    const averageBugEffortMinutes = bugEfforts.length > 0 ? average(bugEfforts) : averageEffortMinutes;
    const remainingBugCount = Math.max(gompertz.estimatedTotalBugs - gompertz.totalBugsFixed, 0);
    if (remainingBugCount > 0 && averageBugEffortMinutes <= 0) {
      throw new SprintPrerequisiteError(['bug_effort']);
    }
    if (bugEfforts.length === 0 && gompertz.estimatedTotalBugs > gompertz.totalBugsFixed) {
      warnings.push('bug effort unavailable: project average effort used');
    }
    const averageInflowEffortMinutes = inflow.averageEffortMinutes > 0
      ? inflow.averageEffortMinutes
      : averageEffortMinutes;
    if (inflow.lambda > 0 && averageInflowEffortMinutes <= 0) {
      throw new SprintPrerequisiteError(['inflow_effort']);
    }
    if (inflow.lambda > 0 && inflow.averageEffortMinutes === 0) {
      warnings.push('inflow effort unavailable: project average effort used');
    }
    const capacity = calculateSprintCapacity({
      sprintDays,
      throughputPerDay: velocity?.throughput ?? 0,
      remainingBugCount,
      averageBugEffortMinutes,
      inflowLambda: inflow.lambda,
      averageInflowEffortMinutes,
      tasks: built.candidates,
    });
    if (capacity.isReserveOverCapacity) warnings.push('bug and inflow reserves consume the full sprint capacity');

    const sprintId = (deps.id ?? randomUUID)();
    const periodEnd = new Date(now.getTime() + sprintDays * MS_PER_DAY);
    const gompertzSnapshot = {
      report: gompertz,
      inflow,
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
      projectRef: project.id,
      goalRef: input.goalRef ?? null,
      periodStart: now.toISOString(),
      periodEnd: periodEnd.toISOString(),
      targetVelocity: velocity?.throughput ?? 0,
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

  async function design(input: { projectRef: string; goalRef?: string; sprintDays?: number }) {
    const sprintDays = input.sprintDays ?? DEFAULT_SPRINT_DAYS;
    if (!Number.isInteger(sprintDays) || sprintDays < 1 || sprintDays > 28) {
      throw new Error('sprintDays must be an integer between 1 and 28');
    }
    const now = deps.now?.() ?? new Date();
    const handle = await resolveSprintProject(deps.clients, input.projectRef);
    if (handle.scope === '<private-reference-004>') {
      return design<private-reference-004>(deps, handle, { goalRef: input.goalRef, sprintDays }, now);
    }
    return designPm(handle, { goalRef: input.goalRef, sprintDays }, now);
  }

  async function replanPm(
    project: { id: string; name: string },
    existing: NonNullable<Awaited<ReturnType<CalliopeRepository['getSprintWithTasks']>>>,
  ) {
    const actio = deps.clients.actio;
    if (!actio) throw new SprintPrerequisiteError(['actio']);
    const sprintId = existing.id;
    const now = deps.now?.() ?? new Date();
    const [tasks, gompertz, estimates, priorities, velocities, goalEvals] = await Promise.all([
      actio.listPmTasks(project.id),
      actio.getGompertz(project.id),
      deps.repo.listTaskEstimates(),
      deps.repo.listPriorities({ scope: 'task' }),
      deps.repo.listLatestVelocity(),
      deps.clients.memoria
        ? deps.clients.memoria.getGoalEvals(now.toISOString().slice(0, 7))
        : Promise.resolve(null),
    ]);
    const velocity = findVelocity(velocities, project.id, project.name);
    if (!velocity || velocity.throughput <= 0) throw new SprintPrerequisiteError(['velocity']);
    const built = buildCandidates(project.id, tasks, estimates, priorities);
    const currentByRef = new Map(tasks.map((task) => [taskRef(project.id, task), task]));
    const states = existing.tasks.map((committed) => {
      const current = currentByRef.get(committed.taskRef);
      return {
        taskRef: committed.taskRef,
        status: current === undefined ? 'removed' as const :
          isCompletedStatus(current.status) ? 'completed' as const : 'committed' as const,
        sourceStatus: current?.status ?? 'missing',
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
    const inflow = await loadInflow(actio, project.id, tasks, effortByRef, now);
    const remainingDays = Math.max(daysBetween(now, periodEnd), 1 / 24);
    const averageEffortMinutes = average(existing.tasks.map((task) => task.effortMinutes));
    const capacity = calculateSprintCapacity({
      sprintDays: Math.max(Math.ceil(remainingDays), 1),
      throughputPerDay: velocity.throughput,
      remainingBugCount: Math.max(gompertz.estimatedTotalBugs - gompertz.totalBugsFixed, 0),
      averageBugEffortMinutes: averageEffortMinutes,
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
      !committedRefs.has(taskRef(project.id, task)) && new Date(task.createdAt) >= periodStart).length;
    const scopeCreepRate = scopeCreepCount / Math.max(existing.tasks.length, 1);
    const distribution = parseVelocityDistribution(velocity.distribution);
    const velocitySpread = distribution && distribution.p50 > 0
      ? (distribution.p75 - distribution.p25) / distribution.p50
      : 1;
    const parsedGoal = existing.goalRef ? parseTaskRef(existing.goalRef) : null;
    const goalSourceId = parsedGoal?.source === 'actio'
      ? parsedGoal.taskId
      : parsedGoal?.source === 'actio-pm' ? parsedGoal.externalId : null;
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
      gompertzConfidence: gompertz.confidenceLevel,
      goalProgress,
    };
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
      gompertzParams: { report: gompertz, health, proposals },
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
        ...(inflow.fallbackCount > 0
          ? [`inflow_history_incomplete: used task.createdAt for ${inflow.fallbackCount} task(s)`]
          : []),
        ...(!latestGoalEval
          ? ['goal_eval_unavailable: Actio completion ratio used for sprint health']
          : []),
      ],
    };
  }

  async function replan(sprintId: string) {
    const existing = await deps.repo.getSprintWithTasks(sprintId);
    if (!existing) throw new Error(`sprint not found: ${sprintId}`);
    if (existing.status === 'closed') throw new Error(`sprint is closed: ${sprintId}`);
    const handle = await resolveSprintProject(deps.clients, existing.projectRef);
    if (handle.scope === '<private-reference-004>') return replan<private-reference-004>(deps, handle, existing);
    return replanPm(handle, existing);
  }

  return {
    design,
    replan,
    activate: async (id: string) => deps.repo.activateSprint(id, (deps.now?.() ?? new Date()).toISOString()),
    close: async (id: string, options: { createNext?: boolean; goalAchieved?: boolean } = {}) => {
      const before = await deps.repo.getSprintWithTasks(id);
      if (!before) throw new Error(`sprint not found: ${id}`);
      if (before.status !== 'active') throw new Error(`sprint is not active: ${id}`);
      const carryover = before.tasks.filter((task) => task.status === 'committed').map((task) => task.taskRef);
      const shouldCreateNext = (options.createNext ?? true) && !options.goalAchieved;
      const sprintDays = Math.max(Math.round(daysBetween(
        new Date(before.periodStart),
        new Date(before.periodEnd),
      )), 1);
      // Rotation: secure the successor before closing the active sprint.
      const nextSprint = shouldCreateNext
        ? await design({
          projectRef: before.projectRef,
          goalRef: before.goalRef ?? undefined,
          sprintDays: Math.min(sprintDays, 28),
        })
        : null;
      const closed = await deps.repo.closeSprint(id, (deps.now?.() ?? new Date()).toISOString());
      return {
        sprint: closed,
        carryover,
        nextSprint,
      };
    },
  };
}
