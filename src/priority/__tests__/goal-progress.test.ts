import { describe, expect, it } from 'vitest';
import { scorePriority } from '../score.ts';

describe('goal progress urgency', () => {
  it('uses goal_eval lag when it is more urgent than the deadline signal', () => {
    const result = scorePriority({
      now: new Date('2026-07-11T00:00:00.000Z'),
      dueAt: null,
      goalProgressUrgency: 0.8,
    });
    expect(result.breakdown.urgency).toBe(0.8);
    expect(result.breakdown.goal_progress_urgency).toBe(0.8);
  });
});
