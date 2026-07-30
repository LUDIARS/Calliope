import { z } from 'zod';
import { stocktakeSummarySchema } from '../stocktake/payload.ts';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const curveHealthSchema = z.object({
  health: z.object({ status: z.enum(['complete', 'at_risk', 'on_track']) }),
});

export interface BriefingPlanEntry {
  taskRef: string;
  startAt: string | null;
  endAt: string | null;
  lane: string;
  seq: number;
  isHumanGate: boolean;
}

export interface BriefingSprint {
  id: string;
  projectRef: string;
  goalRef: string | null;
  periodEnd: string;
  latestCurve: { gompertzParams: unknown } | null;
}

export interface BriefingConfirmation {
  id: string;
  kind: 'plan_apply' | 'reschedule' | 'calendar_write' | 'task_stocktake';
  expiresAt: string;
  payload?: unknown;
}

export interface BriefingRisk {
  goalRef: string;
  projectedCompletion: string;
  deadline: string;
  level: 'green' | 'amber' | 'red';
}

export interface ComposeBriefingInput {
  now: Date;
  plan: { id: string; entries: BriefingPlanEntry[] } | null;
  sprints: BriefingSprint[];
  confirmations: BriefingConfirmation[];
  risks: BriefingRisk[];
}

function jstDayRange(now: Date) {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - JST_OFFSET_MS;
  return { start, end: start + DAY_MS, date: new Date(start + JST_OFFSET_MS).toISOString().slice(0, 10) };
}

function overlapsDay(entry: BriefingPlanEntry, start: number, end: number): boolean {
  if (!entry.startAt && !entry.endAt) return false;
  const entryStart = entry.startAt ? Date.parse(entry.startAt) : Number.NEGATIVE_INFINITY;
  const entryEnd = entry.endAt ? Date.parse(entry.endAt) : Number.POSITIVE_INFINITY;
  return entryStart < end && entryEnd >= start;
}

export function composeDailyBriefing(input: ComposeBriefingInput) {
  const range = jstDayRange(input.now);
  const entries = (input.plan?.entries ?? [])
    .filter((entry) => overlapsDay(entry, range.start, range.end))
    .sort((a, b) => a.lane.localeCompare(b.lane) || a.seq - b.seq);
  const lanes = new Map<string, BriefingPlanEntry[]>();
  for (const entry of entries) {
    const laneEntries = lanes.get(entry.lane) ?? [];
    laneEntries.push(entry);
    lanes.set(entry.lane, laneEntries);
  }
  const byLane = [...lanes].map(([lane, laneEntries]) => ({ lane, entries: laneEntries }));
  const liveConfirmations = input.confirmations
    .filter((item) => Date.parse(item.expiresAt) > input.now.getTime());
  const decisions = liveConfirmations.map(({ id, kind, expiresAt }) => ({ id, kind, expiresAt }));
  // 棚卸しサマリ (task-lifecycle §G3): 最新の pending task_stocktake confirmation の
  // 集計値だけを載せる。 新たな上流呼び出しはせず、 個人データも持ち込まない。
  const stocktake = (() => {
    const active = liveConfirmations.find((item) => item.kind === 'task_stocktake');
    if (!active) return null;
    const summary = stocktakeSummarySchema.safeParse(
      active.payload && typeof active.payload === 'object'
        ? (active.payload as { summary?: unknown }).summary
        : undefined,
    );
    return summary.success ? { confirmationId: active.id, ...summary.data } : null;
  })();
  const sprintAlerts = input.sprints.flatMap((sprint) => {
    const parsed = sprint.latestCurve ? curveHealthSchema.safeParse(sprint.latestCurve.gompertzParams) : null;
    return parsed?.success && parsed.data.health.status === 'at_risk'
      ? [{ type: 'sprint_at_risk' as const, sprintId: sprint.id, projectRef: sprint.projectRef }]
      : [];
  });
  const riskAlerts = input.risks.filter((risk) => risk.level !== 'green').map((risk) => ({
    type: 'goal_risk' as const,
    goalRef: risk.goalRef,
    level: risk.level,
    projectedCompletion: risk.projectedCompletion,
    deadline: risk.deadline,
  }));
  const deadlineCutoff = range.end + (6 * DAY_MS);
  const upcomingDeadlines = input.risks
    .filter((risk) => Date.parse(risk.deadline) < deadlineCutoff)
    .map((risk) => ({ goalRef: risk.goalRef, deadline: risk.deadline, level: risk.level }));
  const humanGates = entries.filter((entry) => entry.isHumanGate).map((entry) => ({
    taskRef: entry.taskRef,
    lane: entry.lane,
    startAt: entry.startAt,
    endAt: entry.endAt,
  }));
  return {
    date: range.date,
    generatedAt: input.now.toISOString(),
    planId: input.plan?.id ?? null,
    todayPlan: byLane,
    decisions,
    alerts: [...sprintAlerts, ...riskAlerts],
    upcomingDeadlines,
    humanGates,
    stocktake,
    summary: {
      tasks: entries.length,
      decisions: decisions.length,
      alerts: sprintAlerts.length + riskAlerts.length,
      humanGates: humanGates.length,
      stocktakeProposals: stocktake?.proposals ?? 0,
    },
  };
}

export type DailyBriefing = ReturnType<typeof composeDailyBriefing>;
