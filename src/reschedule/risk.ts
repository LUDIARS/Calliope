import type { ReturnTypeOfComparePlans } from './types.ts';

export interface RescheduleTaskMeta {
  taskRef: string;
  projectRef: string;
  dueAt: string | null;
}

export interface RescheduleRiskOptions {
  now: Date;
  tasks: RescheduleTaskMeta[];
  triggerProjectRef?: string;
  dueOverrides?: Record<string, string>;
}

export function assessRescheduleRisk(diff: ReturnTypeOfComparePlans, options: RescheduleRiskOptions) {
  const meta = new Map(options.tasks.map((task) => [task.taskRef, task]));
  const reasons: Array<{ code: string; taskRef: string }> = [];
  for (const move of diff.moved) {
    if (move.humanGateMoved) reasons.push({ code: 'human_gate_moved', taskRef: move.taskRef });
    const beforeStart = move.before.startAt ? new Date(move.before.startAt).getTime() : null;
    const beforeEnd = move.before.endAt ? new Date(move.before.endAt).getTime() : null;
    const task = meta.get(move.taskRef);
    const isRunning = beforeStart !== null && beforeEnd !== null &&
      beforeStart <= options.now.getTime() && beforeEnd > options.now.getTime();
    if (isRunning && (!options.triggerProjectRef || task?.projectRef !== options.triggerProjectRef)) {
      reasons.push({ code: 'running_cross_project_preempted', taskRef: move.taskRef });
    }
    if (options.triggerProjectRef && task?.projectRef !== options.triggerProjectRef) {
      reasons.push({ code: 'cross_project_reallocation', taskRef: move.taskRef });
    }
    const due = options.dueOverrides?.[move.taskRef] ?? task?.dueAt;
    if (due && move.after.endAt && new Date(move.after.endAt).getTime() > new Date(due).getTime()) {
      reasons.push({ code: 'deadline_slip', taskRef: move.taskRef });
    }
  }
  for (const removed of diff.removed) {
    reasons.push({ code: 'scope_removed', taskRef: removed.taskRef });
  }
  for (const added of diff.added) {
    const task = meta.get(added.taskRef);
    const due = options.dueOverrides?.[added.taskRef] ?? task?.dueAt;
    if (due && added.endAt && new Date(added.endAt).getTime() > new Date(due).getTime()) {
      reasons.push({ code: 'deadline_slip', taskRef: added.taskRef });
    }
  }
  return {
    level: reasons.length > 0 ? 'high' as const : 'low' as const,
    reasons,
    requiresConfirmation: reasons.length > 0,
  };
}
