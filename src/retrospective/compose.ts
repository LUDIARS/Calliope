import { z } from 'zod';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const curveSchema = z.object({
  health: z.object({ scopeCreepRate: z.number() }),
});
const accuracySchema = z.record(z.string(), z.object({
  mape: z.number(), bias: z.number(), sampleSize: z.number().int().nonnegative(),
}));

export interface RetrospectiveVelocity {
  projectRef: string;
  category: string;
  windowEnd: string;
  kFactor: number;
  distribution: unknown;
}

export interface RetrospectiveCurve {
  sprintId: string;
  date: string;
  gompertzParams: unknown;
}

export interface RetrospectivePriority {
  ref: string;
  breakdown: unknown;
}

export interface RetrospectiveLog {
  trigger: string;
  outcome: 'proposed' | 'applied' | 'rejected' | 'expired';
  createdAt: string;
}

export interface ComposeRetrospectiveInput {
  now: Date;
  velocities: RetrospectiveVelocity[];
  curves: RetrospectiveCurve[];
  priorities: RetrospectivePriority[];
  logs: RetrospectiveLog[];
}

function weekRange(now: Date) {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  const localStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const mondayOffset = (shifted.getUTCDay() + 6) % 7;
  const start = localStart - mondayOffset * DAY_MS - JST_OFFSET_MS;
  return { start, end: start + 7 * DAY_MS };
}

export function composeWeeklyRetrospective(input: ComposeRetrospectiveInput) {
  const range = weekRange(input.now);
  const grouped = new Map<string, RetrospectiveVelocity[]>();
  for (const row of [...input.velocities].sort((a, b) => b.windowEnd.localeCompare(a.windowEnd))) {
    const key = `${row.projectRef}\u0000${row.category}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const velocityDrift = [...grouped.values()].map((rows) => {
    const current = rows[0];
    const previous = rows[1];
    if (!current) throw new Error('velocity group unexpectedly empty');
    const changeRatio = previous && previous.kFactor !== 0
      ? (current.kFactor - previous.kFactor) / previous.kFactor
      : null;
    return {
      projectRef: current.projectRef,
      category: current.category,
      currentKFactor: current.kFactor,
      previousKFactor: previous?.kFactor ?? null,
      changeRatio,
    };
  });
  const weeklyCurves = input.curves.filter((curve) => {
    const at = Date.parse(`${curve.date}T00:00:00+09:00`);
    return at >= range.start && at < range.end;
  });
  const scopeRates = weeklyCurves.flatMap((curve) => {
    const parsed = curveSchema.safeParse(curve.gompertzParams);
    return parsed.success ? [parsed.data.health.scopeCreepRate] : [];
  });
  const scopeCreep = {
    averageRate: scopeRates.length === 0 ? 0 : scopeRates.reduce((sum, value) => sum + value, 0) / scopeRates.length,
    sampledSprints: new Set(weeklyCurves.map((curve) => curve.sprintId)).size,
  };
  const starvation = input.priorities.flatMap((priority) => {
    if (!priority.breakdown || typeof priority.breakdown !== 'object' || !('aging' in priority.breakdown)) return [];
    const aging = (priority.breakdown as { aging?: unknown }).aging;
    return typeof aging === 'number' && aging > 0 ? [{ ref: priority.ref, aging }] : [];
  });
  const latestAccuracy = [...grouped.values()].flatMap((rows) => {
    const current = rows[0];
    if (!current || !current.distribution || typeof current.distribution !== 'object' ||
      !('accuracyBySource' in current.distribution)) return [];
    const parsed = accuracySchema.safeParse((current.distribution as { accuracyBySource?: unknown }).accuracyBySource);
    return parsed.success ? Object.entries(parsed.data).map(([source, metric]) => ({
      projectRef: current.projectRef, category: current.category, source, ...metric,
    })) : [];
  });
  const weeklyLogs = input.logs.filter((log) => {
    const at = Date.parse(log.createdAt);
    return at >= range.start && at < range.end;
  });
  const reschedules = {
    total: weeklyLogs.length,
    applied: weeklyLogs.filter((log) => log.outcome === 'applied').length,
    proposed: weeklyLogs.filter((log) => log.outcome === 'proposed').length,
    rejected: weeklyLogs.filter((log) => log.outcome === 'rejected').length,
    expired: weeklyLogs.filter((log) => log.outcome === 'expired').length,
  };
  const recommendations: Array<{ code: string; message: string }> = [];
  if (velocityDrift.some((item) => item.changeRatio !== null && Math.abs(item.changeRatio) >= 0.2)) {
    recommendations.push({ code: 'review_velocity_weights', message: 'Review velocity assumptions; k-factor moved by at least 20%.' });
  }
  if (scopeCreep.averageRate >= 0.1) {
    recommendations.push({ code: 'review_sprint_scope', message: 'Review sprint length or committed scope; scope creep averaged at least 10%.' });
  }
  if (starvation.length > 0) {
    recommendations.push({ code: 'review_priority_weights', message: 'Review priority weights; aging activated for ready work.' });
  }
  if (latestAccuracy.some((item) => item.mape >= 0.5)) {
    recommendations.push({ code: 'review_estimation_source', message: 'Review estimation sources with MAPE at or above 50%.' });
  }
  return {
    weekStart: new Date(range.start).toISOString(),
    weekEnd: new Date(range.end).toISOString(),
    generatedAt: input.now.toISOString(),
    velocityDrift,
    scopeCreep,
    starvation,
    estimationAccuracy: latestAccuracy,
    reschedules,
    recommendations,
  };
}

export type WeeklyRetrospective = ReturnType<typeof composeWeeklyRetrospective>;
