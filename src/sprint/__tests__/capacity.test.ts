import { describe, expect, it } from 'vitest';
import { calculateSprintCapacity } from '../capacity.ts';
import { calculateInflow } from '../inflow.ts';

describe('sprint capacity', () => {
  it('reserves bug and inflow effort before selecting ready tasks by priority', () => {
    const result = calculateSprintCapacity({
      sprintDays: 10,
      throughputPerDay: 100,
      remainingBugCount: 2,
      averageBugEffortMinutes: 100,
      inflowLambda: 0.5,
      averageInflowEffortMinutes: 100,
      tasks: [
        { taskRef: 'high', effortMinutes: 200, priority: 1, isReady: true },
        { taskRef: 'medium', effortMinutes: 150, priority: 0.5, isReady: true },
        { taskRef: 'blocked', effortMinutes: 50, priority: 2, isReady: false },
      ],
    });
    expect(result).toMatchObject({
      rawCapacityMinutes: 1000,
      bugReserveMinutes: 200,
      inflowReserveMinutes: 500,
      effectiveCapacityMinutes: 300,
      committedMinutes: 200,
    });
    expect(result.selected.map((task) => task.taskRef)).toEqual(['high']);
    expect(result.excluded).toEqual(expect.arrayContaining([
      { taskRef: 'blocked', reason: 'blocked' },
      { taskRef: 'medium', reason: 'capacity' },
    ]));
  });

  it('reports reserves that consume all capacity', () => {
    const result = calculateSprintCapacity({
      sprintDays: 1,
      throughputPerDay: 60,
      remainingBugCount: 2,
      averageBugEffortMinutes: 60,
      inflowLambda: 0,
      averageInflowEffortMinutes: 0,
      tasks: [{ taskRef: 'a', effortMinutes: 1, priority: 1, isReady: true }],
    });
    expect(result.isReserveOverCapacity).toBe(true);
    expect(result.effectiveCapacityMinutes).toBe(0);
    expect(result.selected).toEqual([]);
  });
});

describe('inflow', () => {
  it('uses only events inside the deterministic lookback window', () => {
    const result = calculateInflow([
      { taskRef: 'recent-a', createdAt: '2026-07-09T00:00:00.000Z', effortMinutes: 60 },
      { taskRef: 'recent-b', createdAt: '2026-07-08T00:00:00.000Z', effortMinutes: 120 },
      { taskRef: 'old', createdAt: '2026-06-01T00:00:00.000Z', effortMinutes: 999 },
    ], { now: new Date('2026-07-10T00:00:00.000Z'), windowDays: 10 });
    expect(result.lambda).toBe(0.2);
    expect(result.averageEffortMinutes).toBe(90);
    expect(result.sampleSize).toBe(2);
  });
});
