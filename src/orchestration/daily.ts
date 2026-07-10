const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function millisecondsUntilNextDailyRun(now: Date, hour = 7, minute = 30): number {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const targetAsJst = Date.UTC(
    jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate(), hour, minute, 0, 0,
  );
  const targetUtc = targetAsJst - JST_OFFSET_MS;
  return targetUtc > now.getTime() ? targetUtc - now.getTime() : targetUtc + MS_PER_DAY - now.getTime();
}

export interface DailyOrchestratorOptions {
  now?: () => Date;
  onError?: (error: unknown) => void;
}

export function startDailyOrchestrator(run: () => Promise<unknown>, options: DailyOrchestratorOptions = {}) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
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
    }, millisecondsUntilNextDailyRun(options.now?.() ?? new Date()));
    timer.unref();
  };
  schedule();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
