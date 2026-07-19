import { describe, expect, it } from 'vitest';
import type { ActioTask } from '../../clients/contracts.ts';
import { projectRefForActioTask, toCorePlanningTask } from '../tasks.ts';

function actioTask(overrides: Partial<ActioTask> = {}): ActioTask {
  return {
    id: 'task-1',
    title: 'do the thing',
    description: null,
    requirements: null,
    status: 'open',
    kind: 'task',
    creatorType: 'human',
    category: null,
    priority: 'medium',
    deadline: null,
    estimatedMinutes: null,
    pluginId: null,
    pluginRef: null,
    projectId: null,
    completedAt: null,
    createdAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('projectRefForActioTask', () => {
  it('scopes <private-reference-004>-linked tasks (tasks.project_id set) to <private-reference-004>:<project_id>, ahead of category', () => {
    const task = actioTask({ projectId: '<private-reference-004>-proj-1', category: 'some-category' });
    expect(projectRefForActioTask(task)).toBe('<private-reference-004>:<private-reference-004>-proj-1');
  });

  it('falls back to category when project_id is absent (existing behavior unchanged)', () => {
    const task = actioTask({ category: 'infra' });
    expect(projectRefForActioTask(task)).toBe('infra');
  });

  it('falls back to pluginId when both project_id and category are absent (existing behavior unchanged)', () => {
    const task = actioTask({ pluginId: 'discord-bot' });
    expect(projectRefForActioTask(task)).toBe('discord-bot');
  });

  it('falls back to "actio" when nothing is set (existing behavior unchanged)', () => {
    expect(projectRefForActioTask(actioTask())).toBe('actio');
  });

  it('ignores a blank project_id (whitespace-only) and falls back as if unset', () => {
    const task = actioTask({ projectId: '   ', category: 'infra' });
    expect(projectRefForActioTask(task)).toBe('infra');
  });
});

describe('toCorePlanningTask', () => {
  it('carries the <private-reference-004> project scope through into the planning task projectRef', () => {
    const planningTask = toCorePlanningTask(actioTask({ projectId: '<private-reference-004>-proj-1', category: 'ignored' }));
    expect(planningTask.projectRef).toBe('<private-reference-004>:<private-reference-004>-proj-1');
    expect(planningTask.taskRef).toBe('actio:task-1');
  });
});
