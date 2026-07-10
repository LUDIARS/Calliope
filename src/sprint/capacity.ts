export interface CapacityTask {
  taskRef: string;
  effortMinutes: number;
  priority: number;
  isReady: boolean;
}

export interface SprintCapacityInput {
  sprintDays: number;
  throughputPerDay: number;
  remainingBugCount: number;
  averageBugEffortMinutes: number;
  inflowLambda: number;
  averageInflowEffortMinutes: number;
  tasks: CapacityTask[];
}

export interface CapacityExclusion {
  taskRef: string;
  reason: 'blocked' | 'capacity';
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`);
}

export function calculateSprintCapacity(input: SprintCapacityInput) {
  if (!Number.isInteger(input.sprintDays) || input.sprintDays <= 0) {
    throw new Error('sprintDays must be a positive integer');
  }
  if (!Number.isFinite(input.throughputPerDay) || input.throughputPerDay <= 0) {
    throw new Error('throughputPerDay must be a finite positive number');
  }
  assertNonNegative(input.remainingBugCount, 'remainingBugCount');
  assertNonNegative(input.averageBugEffortMinutes, 'averageBugEffortMinutes');
  assertNonNegative(input.inflowLambda, 'inflowLambda');
  assertNonNegative(input.averageInflowEffortMinutes, 'averageInflowEffortMinutes');
  for (const task of input.tasks) {
    if (!Number.isFinite(task.effortMinutes) || task.effortMinutes <= 0) {
      throw new Error(`task effort must be positive: ${task.taskRef}`);
    }
    if (!Number.isFinite(task.priority)) throw new Error(`task priority must be finite: ${task.taskRef}`);
  }

  const rawCapacityMinutes = input.throughputPerDay * input.sprintDays;
  const bugReserveMinutes = input.remainingBugCount * input.averageBugEffortMinutes;
  const inflowReserveMinutes = input.inflowLambda * input.sprintDays * input.averageInflowEffortMinutes;
  const effectiveCapacityMinutes = Math.max(rawCapacityMinutes - bugReserveMinutes - inflowReserveMinutes, 0);
  const sorted = [...input.tasks].sort((a, b) => b.priority - a.priority || a.taskRef.localeCompare(b.taskRef));
  const selected: CapacityTask[] = [];
  const excluded: CapacityExclusion[] = [];
  let committedMinutes = 0;
  for (const task of sorted) {
    if (!task.isReady) {
      excluded.push({ taskRef: task.taskRef, reason: 'blocked' });
      continue;
    }
    if (committedMinutes + task.effortMinutes > effectiveCapacityMinutes) {
      excluded.push({ taskRef: task.taskRef, reason: 'capacity' });
      continue;
    }
    selected.push(task);
    committedMinutes += task.effortMinutes;
  }

  return {
    rawCapacityMinutes,
    bugReserveMinutes,
    inflowReserveMinutes,
    bugReserveFraction: bugReserveMinutes / rawCapacityMinutes,
    inflowReserveFraction: inflowReserveMinutes / rawCapacityMinutes,
    effectiveCapacityMinutes,
    committedMinutes,
    remainingCapacityMinutes: effectiveCapacityMinutes - committedMinutes,
    isReserveOverCapacity: bugReserveMinutes + inflowReserveMinutes >= rawCapacityMinutes,
    selected,
    excluded,
  };
}
