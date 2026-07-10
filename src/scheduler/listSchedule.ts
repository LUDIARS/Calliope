import { DagCycleError, type DagTask } from './dag.ts';
import { nextFreeSlot, type TimeInterval } from './freebusy.ts';

export const HUMAN_GATE_MINUTES = 30;
export const HUMAN_BUSINESS_HOURS = { startHour: 9, endHour: 18, utcOffsetMinutes: 540 } as const;

export interface SchedulableTask extends DagTask {
  durationMinutes: number;
  priority: number;
  confidence: number;
  isHumanGate: boolean;
}

export interface ScheduleEntry {
  taskRef: string;
  startAt: string | null;
  endAt: string | null;
  lane: string;
  seq: number;
  confidence: number;
  isHumanGate: boolean;
}

export interface ListScheduleOptions {
  lanes: number;
  startAt: string;
  humanFreeSlots: TimeInterval[] | null;
}

export function listSchedule(tasks: SchedulableTask[], options: ListScheduleOptions): ScheduleEntry[] {
  if (!Number.isInteger(options.lanes) || options.lanes <= 0) throw new Error('lanes must be a positive integer');
  const planningStart = new Date(options.startAt).getTime();
  if (Number.isNaN(planningStart)) throw new Error('invalid planning start');
  const byRef = new Map(tasks.map((task) => [task.taskRef, task]));
  const order = new Map(tasks.map((task, index) => [task.taskRef, index]));
  const inDegree = new Map(tasks.map((task) => [
    task.taskRef,
    task.blockedBy.filter((dependency) => byRef.has(dependency)).length,
  ]));
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.blockedBy) {
      if (!byRef.has(dependency)) continue;
      const values = dependents.get(dependency) ?? [];
      values.push(task.taskRef);
      dependents.set(dependency, values);
    }
  }

  const ready = tasks.filter((task) => inDegree.get(task.taskRef) === 0);
  const laneFreeAt = Array.from({ length: options.lanes }, () => planningStart);
  const finishAt = new Map<string, number>();
  const entries: ScheduleEntry[] = [];

  while (ready.length > 0) {
    ready.sort((a, b) =>
      b.priority - a.priority || (order.get(a.taskRef) ?? 0) - (order.get(b.taskRef) ?? 0));
    const task = ready.shift();
    if (!task) break;
    const dependencyFinish = Math.max(
      planningStart,
      ...task.blockedBy.map((dependency) => finishAt.get(dependency) ?? planningStart),
    );

    let entry: ScheduleEntry;
    if (task.isHumanGate) {
      if (!options.humanFreeSlots) {
        entry = {
          taskRef: task.taskRef,
          startAt: null,
          endAt: null,
          lane: 'human-pending',
          seq: entries.length,
          confidence: task.confidence,
          isHumanGate: true,
        };
        finishAt.set(task.taskRef, dependencyFinish);
      } else {
        const slot = nextFreeSlot(
          options.humanFreeSlots,
          new Date(dependencyFinish).toISOString(),
          HUMAN_GATE_MINUTES,
          HUMAN_BUSINESS_HOURS,
        );
        entry = {
          taskRef: task.taskRef,
          startAt: slot?.start ?? null,
          endAt: slot?.end ?? null,
          lane: slot ? 'human' : 'human-pending',
          seq: entries.length,
          confidence: task.confidence,
          isHumanGate: true,
        };
        finishAt.set(task.taskRef, slot ? new Date(slot.end).getTime() : dependencyFinish);
      }
    } else {
      const lane = laneFreeAt
        .map((freeAt, index) => ({ index, start: Math.max(freeAt, dependencyFinish) }))
        .sort((a, b) => a.start - b.start || a.index - b.index)[0];
      if (!lane) throw new Error('no scheduling lane available');
      const end = lane.start + task.durationMinutes * 60_000;
      laneFreeAt[lane.index] = end;
      finishAt.set(task.taskRef, end);
      entry = {
        taskRef: task.taskRef,
        startAt: new Date(lane.start).toISOString(),
        endAt: new Date(end).toISOString(),
        lane: `ai-${lane.index + 1}`,
        seq: entries.length,
        confidence: task.confidence,
        isHumanGate: false,
      };
    }
    entries.push(entry);

    for (const dependent of dependents.get(task.taskRef) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) {
        const value = byRef.get(dependent);
        if (value) ready.push(value);
      }
    }
  }

  if (entries.length !== tasks.length) {
    const cyclic = tasks.filter((task) => !entries.some((entry) => entry.taskRef === task.taskRef));
    throw new DagCycleError(cyclic.map((task) => task.taskRef));
  }
  return entries;
}
