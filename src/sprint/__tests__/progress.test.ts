import { describe, expect, it } from 'vitest';
import type { ProjectHubSprintTask } from '../candidates.ts';
import { composeProjectHubProjectProgress, type ProgressSprint } from '../progress.ts';

function projecthubTask(overrides: Partial<ProjectHubSprintTask> = {}): ProjectHubSprintTask {
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

function sprint(overrides: Partial<ProgressSprint> = {}): ProgressSprint {
  return {
    id: 'sprint-1',
    status: 'active',
    goalRef: null,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-07-15T00:00:00.000Z',
    tasks: [],
    ...overrides,
  };
}

const now = new Date('2026-07-08T00:00:00.000Z');
const project = { rawId: 'p1', projectRef: 'projecthub:p1', name: 'Demo Game' };

describe('composeProjectHubProjectProgress', () => {
  it('returns a degenerate no_sprint report when the project has no sprint yet', () => {
    const result = composeProjectHubProjectProgress({
      now, project, sprint: null, currentTasks: [], velocity: null, goalDeadline: null, latestGoalEval: null,
    });
    expect(result.health.status).toBe('no_sprint');
    expect(result.burndown).toBeNull();
    expect(result.risk).toBeNull();
    expect(result.warnings).toContain('no_sprint_for_project: design a sprint via POST /api/sprint to get a progress view');
  });

  it('reports on_track health and green risk when comfortably ahead of the deadline', () => {
    const result = composeProjectHubProjectProgress({
      now,
      project,
      // periodStart == now: the sprint has just started, so the completion-fallback goal
      // progress heuristic (observed vs. elapsed fraction) does not yet expect any work done.
      sprint: sprint({
        periodStart: now.toISOString(),
        tasks: [{ taskRef: 'actio:1', effortMinutes: 60, priorityScore: 1, status: 'committed', committedAt: now.toISOString() }],
      }),
      currentTasks: [projecthubTask({ taskRef: 'actio:1', sourceStatus: 'in_progress' })],
      velocity: { throughput: 120, kFactor: 1, distribution: { p25: 0.8, p50: 1, p75: 1.2 }, sampleSize: 5 },
      goalDeadline: '2026-08-01T00:00:00.000Z',
      latestGoalEval: null,
    });
    expect(result.health.status).toBe('on_track');
    expect(result.risk?.level).toBe('green');
    expect(result.burndown).toMatchObject({ committedMinutes: 60 });
  });

  it('flags a stalled task once it has sat untouched past the threshold', () => {
    const result = composeProjectHubProjectProgress({
      now,
      project,
      sprint: sprint({
        tasks: [{ taskRef: 'actio:1', effortMinutes: 60, priorityScore: 1, status: 'committed', committedAt: '2026-07-01T00:00:00.000Z' }],
      }),
      currentTasks: [projecthubTask({ taskRef: 'actio:1', sourceStatus: 'open' })],
      velocity: { throughput: 60, kFactor: 1, distribution: { p25: 0.5, p50: 1, p75: 1.5 }, sampleSize: 0 },
      goalDeadline: null,
      latestGoalEval: null,
    });
    expect(result.stalledTasks).toEqual([
      expect.objectContaining({ taskRef: 'actio:1', sourceStatus: 'open' }),
    ]);
    expect(result.warnings.some((w) => w.startsWith('velocity_cold_start'))).toBe(true);
  });

  it('explicitly reports missing velocity instead of silently projecting a health status', () => {
    const result = composeProjectHubProjectProgress({
      now,
      project,
      sprint: sprint({
        tasks: [{ taskRef: 'actio:1', effortMinutes: 60, priorityScore: 1, status: 'committed', committedAt: '2026-07-01T00:00:00.000Z' }],
      }),
      currentTasks: [projecthubTask({ taskRef: 'actio:1' })],
      velocity: null,
      goalDeadline: null,
      latestGoalEval: null,
    });
    expect(result.risk).toBeNull();
    expect(result.warnings).toContain('velocity_unavailable: sprint health/risk cannot be projected');
  });
});
