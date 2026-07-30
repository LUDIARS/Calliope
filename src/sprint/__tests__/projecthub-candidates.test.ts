import { describe, expect, it } from 'vitest';
import type { ProjectHubSprintTask } from '../candidates.ts';
import { buildProjectHubCandidates } from '../candidates.ts';

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

describe('buildProjectHubCandidates', () => {
  it('excludes completed tasks and human-gate (goal) tasks', () => {
    const result = buildProjectHubCandidates([
      task({ taskRef: 'actio:done', sourceStatus: 'done' }),
      task({ taskRef: 'actio:goal', isHumanGate: true }),
      task({ taskRef: 'actio:open' }),
    ], [], []);
    expect(result.candidates.map((c) => c.taskRef)).toEqual(['actio:open']);
  });

  it('reports missing estimates instead of silently defaulting effort', () => {
    const result = buildProjectHubCandidates([
      task({ taskRef: 'actio:no-estimate', declaredEffortMinutes: null }),
    ], [], []);
    expect(result.candidates).toHaveLength(0);
    expect(result.missingEstimates).toEqual(['actio:no-estimate']);
  });

  it('falls back to a Calliope-stored estimate when declaredEffortMinutes is null', () => {
    const result = buildProjectHubCandidates(
      [task({ taskRef: 'actio:analogy', declaredEffortMinutes: null })],
      [{ taskRef: 'actio:analogy', effortMinutes: 45 }],
      [],
    );
    expect(result.candidates).toEqual([expect.objectContaining({ taskRef: 'actio:analogy', effortMinutes: 45 })]);
  });

  it('marks tasks without a resolved priority instead of silently scoring them', () => {
    const result = buildProjectHubCandidates([task({ taskRef: 'actio:1' })], [], []);
    expect(result.missingPriorities).toEqual(['actio:1']);
    expect(result.candidates[0]?.priority).toBe(0);
  });

  it('always treats projecthub candidates as ready (H1: dependency graph deferred)', () => {
    const result = buildProjectHubCandidates([task({ taskRef: 'actio:1' })], [], [{ ref: 'actio:1', resolvedScore: 5 }]);
    expect(result.candidates[0]?.isReady).toBe(true);
  });
});
