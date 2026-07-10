import { afterEach, describe, expect, it, vi } from 'vitest';
import { millisecondsUntilNextDailyRun, startDailyOrchestrator } from '../daily.ts';

afterEach(() => vi.useRealTimers());

describe('daily orchestration schedule', () => {
  it('targets 07:30 JST on the same day when upcoming', () => {
    expect(millisecondsUntilNextDailyRun(new Date('2026-07-10T21:00:00.000Z'))).toBe(90 * 60 * 1000);
  });
  it('rolls to the next day after 07:30 JST', () => {
    expect(millisecondsUntilNextDailyRun(new Date('2026-07-10T23:00:00.000Z')))
      .toBe(23.5 * 60 * 60 * 1000);
  });
  it('releases its timer when stopped', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const orchestrator = startDailyOrchestrator(run, {
      now: () => new Date('2026-07-10T21:00:00.000Z'),
    });
    orchestrator.stop();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(run).not.toHaveBeenCalled();
  });
});
