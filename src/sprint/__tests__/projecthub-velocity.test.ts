import { describe, expect, it } from 'vitest';
import type { ProjectHubSprintTask } from '../candidates.ts';
import { calculateProjectHubVelocityFallback } from '../projecthub-velocity.ts';

function task(overrides: Partial<ProjectHubSprintTask> = {}): ProjectHubSprintTask {
  return {
    taskRef: 'actio:task-1',
    sourceId: 'task-1',
    sourceStatus: 'open',
    labels: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    completedAt: null,
    declaredEffortMinutes: 60,
    isHumanGate: false,
    ...overrides,
  };
}

describe('calculateProjectHubVelocityFallback', () => {
  const now = new Date('2026-07-15T00:00:00.000Z');

  it('uses completed-task throughput (k=1, wide band) when completions exist in the window', () => {
    const tasks = [
      task({ taskRef: 'actio:1', sourceStatus: 'done', completedAt: '2026-07-10T00:00:00.000Z', declaredEffortMinutes: 120 }),
      task({ taskRef: 'actio:2', sourceStatus: 'done', completedAt: '2026-07-12T00:00:00.000Z', declaredEffortMinutes: 60 }),
      task({ taskRef: 'actio:3', sourceStatus: 'open', declaredEffortMinutes: 90 }),
    ];
    const result = calculateProjectHubVelocityFallback('projecthub:p1', tasks, now);
    expect(result.source).toBe('projecthub_completed_throughput');
    expect(result.kFactor).toBe(1);
    expect(result.sampleSize).toBe(2);
    expect(result.throughput).toBeCloseTo(180 / 28, 5);
    expect(result.distribution.p50).toBe(1);
    expect(result.distribution.p75).toBeGreaterThan(result.distribution.p50);
  });

  it('falls back to declared backlog capacity (cold start) when nothing completed in the window', () => {
    const tasks = [
      task({ taskRef: 'actio:1', sourceStatus: 'open', declaredEffortMinutes: 100 }),
      task({ taskRef: 'actio:2', sourceStatus: 'in_progress', declaredEffortMinutes: 50 }),
      task({ taskRef: 'actio:3', sourceStatus: 'done', completedAt: '2020-01-01T00:00:00.000Z', declaredEffortMinutes: 999 }),
      task({ taskRef: 'actio:goal', sourceStatus: 'open', isHumanGate: true, declaredEffortMinutes: 500 }),
    ];
    const result = calculateProjectHubVelocityFallback('projecthub:p1', tasks, now);
    expect(result.source).toBe('projecthub_cold_start_capacity');
    expect(result.sampleSize).toBe(0);
    expect(result.throughput).toBeCloseTo(150 / 28, 5);
  });

  it('returns zero throughput (explicit, not silently substituted) when no declared effort exists at all', () => {
    const tasks = [task({ declaredEffortMinutes: null })];
    const result = calculateProjectHubVelocityFallback('projecthub:p1', tasks, now);
    expect(result.source).toBe('projecthub_cold_start_capacity');
    expect(result.throughput).toBe(0);
  });
});
