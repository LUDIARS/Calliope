import { describe, expect, it } from 'vitest';
import { makeTaskRef, parseTaskRef } from '../refs.ts';

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