import { describe, expect, it } from 'vitest';
import {
  isProjectHubProjectRef,
  makeProjectHubProjectRef,
  makeTaskRef,
  parseProjectHubProjectRef,
  parseTaskRef,
} from '../refs.ts';

describe('task refs', () => {
  it('creates and parses canonical refs', () => {
    expect(makeTaskRef('actio', 'task-1')).toBe('actio:task-1');
    expect(makeTaskRef('actio-pm', 'project-1', 'issue-2')).toBe('actio-pm:project-1/issue-2');
    expect(parseTaskRef('actio:task-1')).toEqual({ source: 'actio', taskId: 'task-1' });
    expect(parseTaskRef('actio-pm:project-1/issue-2')).toEqual({
      source: 'actio-pm',
      projectId: 'project-1',
      externalId: 'issue-2',
    });
  });

  it('rejects non-canonical refs', () => {
    expect(() => parseTaskRef('github:owner/repo#1')).toThrow('invalid task_ref');
    expect(() => makeTaskRef('actio', 'bad/id')).toThrow('invalid task id');
  });
});

describe('projecthub project scope refs', () => {
  it('creates and parses canonical projecthub project refs', () => {
    expect(makeProjectHubProjectRef('proj-1')).toBe('projecthub:proj-1');
    expect(parseProjectHubProjectRef('projecthub:proj-1')).toEqual({ source: 'projecthub', projectId: 'proj-1' });
    expect(isProjectHubProjectRef('projecthub:proj-1')).toBe(true);
  });

  it('rejects invalid projecthub project ids and non-projecthub refs', () => {
    expect(() => makeProjectHubProjectRef('bad/id')).toThrow('invalid projecthub project id');
    expect(parseProjectHubProjectRef('actio:task-1')).toBeNull();
    expect(isProjectHubProjectRef('actio:task-1')).toBe(false);
  });
});
