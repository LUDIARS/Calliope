const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface InflowEvent {
  taskRef: string;
  createdAt: string;
  effortMinutes: number | null;
}

export interface InflowOptions {
  now?: Date;
  windowDays?: number;
}

export function calculateInflow(events: InflowEvent[], options: InflowOptions = {}) {
  const windowDays = options.windowDays ?? 28;
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw new Error('windowDays must be a positive integer');
  const now = options.now ?? new Date();
  const start = new Date(now.getTime() - windowDays * MS_PER_DAY);
  const eligible = events.filter((event) => {
    const timestamp = new Date(event.createdAt).getTime();
    if (!Number.isFinite(timestamp)) throw new Error(`invalid inflow timestamp: ${event.taskRef}`);
    return timestamp >= start.getTime() && timestamp <= now.getTime();
  });
  const efforts = eligible
    .map((event) => event.effortMinutes)
    .filter((effort): effort is number => effort !== null && effort > 0);
  return {
    lambda: eligible.length / windowDays,
    averageEffortMinutes: efforts.length === 0
      ? 0
      : efforts.reduce((sum, effort) => sum + effort, 0) / efforts.length,
    sampleSize: eligible.length,
    effortSampleSize: efforts.length,
    windowStart: start.toISOString(),
    windowEnd: now.toISOString(),
  };
}
