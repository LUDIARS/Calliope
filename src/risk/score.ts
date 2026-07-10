export type RiskLevel = 'green' | 'amber' | 'red';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface GoalRiskInput {
  now: Date;
  deadline: string;
  criticalPathDays: number;
  p50Factor: number;
  p80Factor: number;
}

function timestamp(value: string, endOfDay: boolean): number {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : value;
  const parsed = new Date(normalized).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`invalid date: ${value}`);
  return parsed;
}

export function evaluateGoalRisk(input: GoalRiskInput) {
  if (!Number.isFinite(input.criticalPathDays) || input.criticalPathDays < 0) {
    throw new Error('criticalPathDays must be a finite non-negative number');
  }
  if (!Number.isFinite(input.p50Factor) || input.p50Factor < 0) {
    throw new Error('p50Factor must be a finite non-negative number');
  }
  if (!Number.isFinite(input.p80Factor) || input.p80Factor < input.p50Factor) {
    throw new Error('p80Factor must be finite and at least p50Factor');
  }
  const deadlineAt = timestamp(input.deadline, true);
  const p50At = input.now.getTime() + input.criticalPathDays * input.p50Factor * MS_PER_DAY;
  const p80At = input.now.getTime() + input.criticalPathDays * input.p80Factor * MS_PER_DAY;
  const level: RiskLevel = p50At > deadlineAt ? 'red' : p80At > deadlineAt ? 'amber' : 'green';
  return {
    level,
    projectedCompletion: new Date(p50At).toISOString(),
    p80Completion: new Date(p80At).toISOString(),
    deadline: new Date(deadlineAt).toISOString(),
    slackDaysP50: (deadlineAt - p50At) / MS_PER_DAY,
    slackDaysP80: (deadlineAt - p80At) / MS_PER_DAY,
  };
}
