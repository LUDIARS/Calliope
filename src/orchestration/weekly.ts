const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function millisecondsUntilNextWeeklyRun(now: Date, weekday = 1, hour = 8): number {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const daysAhead = (weekday - jstNow.getUTCDay() + 7) % 7;
  let target = Date.UTC(
    jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + daysAhead, hour,
  ) - JST_OFFSET_MS;
  if (target <= now.getTime()) target += WEEK_MS;
  return target - now.getTime();
}

export function startWeeklyOrchestrator(
  run: () => Promise<unknown>,
  options: { now?: () => Date; onError?: (error: unknown) => void } = {},
) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await run();
      } catch (error) {
        options.onError?.(error);
      } finally {
        schedule();
      }
    }, millisecondsUntilNextWeeklyRun(options.now?.() ?? new Date()));
    timer.unref();
  };
  schedule();
  return { stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; } };
}
