import { describe, expect, it } from 'vitest';
import { scorePriority } from '../score.ts';

const now = new Date('2026-07-10T00:00:00.000Z');

describe('scorePriority', () => {
  it('keeps urgency neutral without a due date', () => {
    expect(scorePriority({ now }).breakdown.urgency).toBe(0);
  });

  it('ramps urgency over the 30 day horizon', () => {
    const result = scorePriority({ now, dueAt: '2026-07-25T00:00:00.000Z' });
    expect(result.breakdown.urgency).toBeCloseTo(0.5);
  });

  it('saturates overdue urgency and records overdue days', () => {
    const result = scorePriority({ now, dueAt: '2026-07-07T00:00:00.000Z' });
    expect(result.breakdown).toMatchObject({ urgency: 1, overdue_days: 3 });
  });

  it('caps aging at one and honors component overrides', () => {
    const result = scorePriority({
      now,
      firstReadyAt: '2026-06-01T00:00:00.000Z',
      taskPriority: 'low',
      overrides: { task: 1 },
    });
    expect(result.breakdown.aging).toBe(1);
    expect(result.breakdown.task).toBe(1);
    expect(result.breakdown.override).toEqual({ task: 1 });
  });
});