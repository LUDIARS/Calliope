import { AGING_MAX_DAYS, PRIORITY_HORIZON_DAYS, PRIORITY_WEIGHTS } from './weights.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PriorityOverrides {
  proj?: number;
  goal?: number;
  task?: number;
  urgency?: number;
  aging?: number;
}

export interface PriorityScoreInput {
  projectImportance?: number | null;
  goalPriority?: string | null;
  taskPriority?: string | null;
  dueAt?: string | null;
  firstReadyAt?: string | null;
  now: Date;
  overrides?: PriorityOverrides;
}

export interface PriorityBreakdown {
  proj: number;
  goal: number;
  task: number;
  urgency: number;
  aging: number;
  overdue_days?: number;
  override?: PriorityOverrides;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizePriority(value: string | null | undefined): number {
  switch (value?.toLowerCase()) {
    case 'low': return 0.25;
    case 'med':
    case 'medium': return 0.5;
    case 'high': return 0.75;
    case 'critical': return 1;
    default: return 0;
  }
}

function urgency(dueAt: string | null | undefined, now: Date): { value: number; overdueDays?: number } {
  if (!dueAt) return { value: 0 };
  const daysToDue = (new Date(dueAt).getTime() - now.getTime()) / MS_PER_DAY;
  if (daysToDue < 0) {
    return { value: 1, overdueDays: Math.ceil(Math.abs(daysToDue)) };
  }
  return { value: clamp((PRIORITY_HORIZON_DAYS - daysToDue) / PRIORITY_HORIZON_DAYS) };
}

function aging(firstReadyAt: string | null | undefined, now: Date): number {
  if (!firstReadyAt) return 0;
  const waitDays = Math.max(0, (now.getTime() - new Date(firstReadyAt).getTime()) / MS_PER_DAY);
  return Math.min(waitDays / AGING_MAX_DAYS, 1);
}

export function scorePriority(input: PriorityScoreInput): {
  resolvedScore: number;
  breakdown: PriorityBreakdown;
} {
  const due = urgency(input.dueAt, input.now);
  const base = {
    proj: clamp((input.projectImportance ?? 0) / 3),
    goal: normalizePriority(input.goalPriority),
    task: normalizePriority(input.taskPriority),
    urgency: due.value,
    aging: aging(input.firstReadyAt, input.now),
  };
  const components = { ...base, ...input.overrides };
  const breakdown: PriorityBreakdown = {
    ...components,
    ...(due.overdueDays === undefined ? {} : { overdue_days: due.overdueDays }),
    ...(input.overrides ? { override: input.overrides } : {}),
  };
  return {
    resolvedScore:
      components.proj * PRIORITY_WEIGHTS.project +
      components.goal * PRIORITY_WEIGHTS.goal +
      components.task * PRIORITY_WEIGHTS.task +
      components.urgency * PRIORITY_WEIGHTS.urgency +
      components.aging * PRIORITY_WEIGHTS.aging,
    breakdown,
  };
}
