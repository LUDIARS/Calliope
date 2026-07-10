import { describe, expect, it } from 'vitest';
import { evaluateGoalRisk } from '../score.ts';

const now = new Date('2026-07-01T00:00:00.000Z');
const deadline = '2026-07-10';

describe('goal risk', () => {
  it('is green when p80 remains before the deadline', () => {
    expect(evaluateGoalRisk({ now, deadline, criticalPathDays: 4, p50Factor: 1, p80Factor: 1.5 }).level)
      .toBe('green');
  });

  it('is amber when p50 fits but p80 misses', () => {
    expect(evaluateGoalRisk({ now, deadline, criticalPathDays: 5, p50Factor: 1, p80Factor: 2 }).level)
      .toBe('amber');
  });

  it('is red when the p50 projection already misses', () => {
    expect(evaluateGoalRisk({ now, deadline, criticalPathDays: 5, p50Factor: 2, p80Factor: 2.5 }).level)
      .toBe('red');
  });
});
