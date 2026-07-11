import { afterEach, describe, expect, it, vi } from 'vitest';
import { millisecondsUntilNextWeeklyRun, startWeeklyOrchestrator } from '../weekly.ts';

afterEach(() => vi.useRealTimers());

describe('weekly retrospective schedule', () => {
  it('targets Monday 08:00 JST', () => {
    expect(millisecondsUntilNextWeeklyRun(new Date('2026-07-12T22:00:00.000Z'))).toBe(60 * 60 * 1000);
  });
  it('rolls one week after the target and releases its timer', async () => {
    expect(millisecondsUntilNextWeeklyRun(new Date('2026-07-12T23:00:00.000Z')))
      .toBe(7 * 24 * 60 * 60 * 1000);
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const weekly = startWeeklyOrchestrator(run, { now: () => new Date('2026-07-12T22:00:00.000Z') });
    weekly.stop();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(run).not.toHaveBeenCalled();
  });
});
