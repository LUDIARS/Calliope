import { randomUUID } from 'node:crypto';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { isCompletedStatus, loadPlanningTasks } from '../planning/tasks.ts';
import { topologicalSort } from './dag.ts';
import { listFreeSlots } from './freebusy.ts';
import { listSchedule, type SchedulableTask } from './listSchedule.ts';
import { velocityConfidence } from '../velocity/distribution.ts';
import { makeCalendarEngine } from '../calendar/engine.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PRIORITY_MAX_AGE_MS = MS_PER_DAY;
const ESTIMATE_MAX_AGE_MS = 30 * MS_PER_DAY;

export class PlanningPrerequisiteError extends Error {
  constructor(public missing: string[]) {
    super(`planning prerequisites missing: ${missing.join(', ')}`);
    this.name = 'PlanningPrerequisiteError';
  }
}

export interface SchedulerEngineDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
  now?: () => Date;
  id?: () => string;
}

function velocityKey(projectRef: string, category: string): string {
  return `${projectRef}\u0000${category}`;
}

function findVelocity<T extends { projectRef: string; category: string }>(
  task: { projectRef: string; category: string },
  rows: T[],
): T | null {
  const byKey = new Map(rows.map((row) => [velocityKey(row.projectRef, row.category), row]));
  return byKey.get(velocityKey(task.projectRef, task.category)) ??
    byKey.get(velocityKey(task.projectRef, '*')) ??
    byKey.get(velocityKey('*', task.category)) ??
    byKey.get(velocityKey('*', '*')) ??
    null;
}

function entryConfidence(row: { sampleSize: number; distribution: unknown } | null): number {
  return row ? velocityConfidence(row.sampleSize, row.distribution) : 0.2;
}

function selectGoalTasks<T extends { taskRef: string; category: string; kind: string }>(
  tasks: T[],
  goalRefs: string[] | undefined,
): T[] {
  if (!goalRefs || goalRefs.length === 0) return tasks;
  const selected = new Set(goalRefs);
  const categories = new Set(tasks
    .filter((task) => task.kind === 'goal' && selected.has(task.taskRef))
    .map((task) => task.category));
  return tasks.filter((task) => selected.has(task.taskRef) || categories.has(task.category));
}

export function makeSchedulerEngine(deps: SchedulerEngineDeps) {
  return {
    async generate(input: {
      goalRefs?: string[];
      horizonDays?: number;
      lanes?: number;
      priorityOverrides?: Record<string, number>;
      persist?: boolean;
    } = {}) {
      const actio = deps.clients.actio;
      if (!actio) throw new PlanningPrerequisiteError(['actio']);
      const horizonDays = input.horizonDays ?? 30;
      if (!Number.isInteger(horizonDays) || horizonDays <= 0 || horizonDays > 365) {
        throw new Error('horizonDays must be an integer between 1 and 365');
      }

      const planningNow = deps.now?.() ?? new Date();
      const [allTasks, estimates, priorities, velocities] = await Promise.all([
        loadPlanningTasks(actio),
        deps.repo.listTaskEstimates(),
        deps.repo.listPriorities(),
        deps.repo.listLatestVelocity(),
      ]);
      const missing: string[] = [];
      if (estimates.length === 0) missing.push('estimates');
      if (priorities.length === 0) missing.push('priority');
      const newestEstimate = Math.max(...estimates.map((row) => new Date(row.estimatedAt).getTime()));
      const newestPriority = Math.max(...priorities.map((row) => new Date(row.updatedAt).getTime()));
      const newestVelocity = Math.max(...velocities.map((row) => new Date(row.windowEnd).getTime()));
      if (estimates.length > 0 && newestEstimate < planningNow.getTime() - ESTIMATE_MAX_AGE_MS) missing.push('estimates_stale');
      if (priorities.length > 0 && newestPriority < planningNow.getTime() - PRIORITY_MAX_AGE_MS) missing.push('priority_stale');
      if (velocities.length > 0 && newestVelocity < planningNow.getTime() - PRIORITY_MAX_AGE_MS) missing.push('velocity_stale');
      if (missing.length > 0) throw new PlanningPrerequisiteError(missing);

      const estimatesByRef = new Map(estimates.map((estimate) => [estimate.taskRef, estimate]));
      const prioritiesByRef = new Map(priorities
        .filter((row) => row.scope === 'task' || row.scope === 'goal')
        .map((row) => [row.ref, row]));
      const active = selectGoalTasks(
        allTasks.filter((task) => !isCompletedStatus(task.status)),
        input.goalRefs,
      );
      const unestimated = active
        .filter((task) => !task.isHumanGate && !estimatesByRef.has(task.taskRef))
        .map((task) => task.taskRef);
      const excludedRefs = new Set(unestimated);
      const blockedByUnestimated: string[] = [];
      let exclusionsChanged = true;
      while (exclusionsChanged) {
        exclusionsChanged = false;
        for (const task of active) {
          if (excludedRefs.has(task.taskRef)) continue;
          if (task.blockedBy.some((dependency) => excludedRefs.has(dependency))) {
            excludedRefs.add(task.taskRef);
            blockedByUnestimated.push(task.taskRef);
            exclusionsChanged = true;
          }
        }
      }
      const schedulable = active
        .filter((task) => !excludedRefs.has(task.taskRef))
        .map((task): SchedulableTask => {
          const estimate = estimatesByRef.get(task.taskRef);
          const velocity = findVelocity(task, velocities);
          const duration = task.isHumanGate
            ? 30
            : (estimate?.effortMinutes ?? 0) * (velocity?.kFactor ?? 1);
          return {
            taskRef: task.taskRef,
            blockedBy: task.blockedBy.filter((dependency) =>
              active.some((candidate) =>
                !excludedRefs.has(candidate.taskRef) && candidate.taskRef === dependency)),
            durationMinutes: Math.max(duration, 1),
            priority: input.priorityOverrides?.[task.taskRef] ??
              prioritiesByRef.get(task.taskRef)?.resolvedScore ?? 0,
            confidence: entryConfidence(velocity),
            isHumanGate: task.isHumanGate,
          };
        });      const topo = topologicalSort(schedulable);
      const start = planningNow;
      const end = new Date(start.getTime() + horizonDays * MS_PER_DAY);
      const warnings: { unestimated: string[]; messages: string[] } = {
        unestimated,
        messages: [
          ...(velocities.length === 0 ? ['velocity unavailable: provisional confidence 0.2'] : []),
          ...(blockedByUnestimated.length > 0
            ? [`${blockedByUnestimated.length} task(s) excluded because an unestimated dependency blocks them`]
            : []),
        ],
      };

      let humanFreeSlots = null;
      if (deps.clients.schedula) {
        const availability = await deps.clients.schedula.freeBusy({
          from: start.toISOString(), to: end.toISOString(),
        });
        humanFreeSlots = listFreeSlots(availability.busy, { from: start.toISOString(), to: end.toISOString() });
        warnings.messages.push(...availability.warnings.map((warning) => `schedula: ${warning}`));
      } else {
        warnings.messages.push('schedula_unconfigured: human gates left pending');
      }

      const entries = listSchedule(topo, {
        lanes: input.lanes ?? deps.config.agentLanes,
        startAt: start.toISOString(),
        humanFreeSlots,
      });
      const planId = (deps.id ?? randomUUID)();
      const velocitySnapshot = velocities.map((row) => ({
        projectRef: row.projectRef,
        category: row.category,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        kFactor: row.kFactor,
        sampleSize: row.sampleSize,
        distribution: row.distribution,
      }));
      const planRecord = {
        id: planId,
        goalRef: input.goalRefs?.length === 1 ? input.goalRefs[0] : null,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        status: 'draft' as const,
        velocitySnapshot,
        createdAt: start.toISOString(),
      };
      const entryRecords = entries.map((entry) => ({
        id: (deps.id ?? randomUUID)(),
        planId,
        taskRef: entry.taskRef,
        startAt: entry.startAt,
        endAt: entry.endAt,
        lane: entry.lane,
        seq: entry.seq,
        schedulaEventId: null,
        confidence: entry.confidence,
        isHumanGate: entry.isHumanGate,
      }));

      if (input.persist === false) {
        return { plan: { ...planRecord, entries: entryRecords }, warnings };
      }
      await deps.repo.createPlanWithEntries(planRecord, entryRecords);

      return {
        plan: await deps.repo.getPlanWithEntries(planId),
        warnings,
      };
    },

    async apply(planId: string) {
      const now = deps.now?.() ?? new Date();
      const applied = await deps.repo.applyPlan(planId, {
        id: (deps.id ?? randomUUID)(),
        trigger: 'manual_apply',
        appliedBy: 'human',
        reason: 'P1 manual plan activation',
        createdAt: now.toISOString(),
      });
      return { ...applied, calendar: await makeCalendarEngine(deps).requestSync(applied.plan.id) };
    },
  };
}
