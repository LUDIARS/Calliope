import { describe, expect, it } from 'vitest';
import {
  is<private-reference-004>ProjectRef,
  make<private-reference-004>ProjectRef,
  makeTaskRef,
  parse<private-reference-004>ProjectRef,
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

describe('<private-reference-004> project scope refs', () => {
  it('creates and parses canonical <private-reference-004> project refs', () => {
    expect(make<private-reference-004>ProjectRef('proj-1')).toBe('<private-reference-004>:proj-1');
    expect(parse<private-reference-004>ProjectRef('<private-reference-004>:proj-1')).toEqual({ source: '<private-reference-004>', projectId: 'proj-1' });
    expect(is<private-reference-004>ProjectRef('<private-reference-004>:proj-1')).toBe(true);
  });

  it('rejects invalid <private-reference-004> project ids and non-<private-reference-004> refs', () => {
    expect(() => make<private-reference-004>ProjectRef('bad/id')).toThrow('invalid <private-reference-004> project id');
    expect(parse<private-reference-004>ProjectRef('actio:task-1')).toBeNull();
    expect(is<private-reference-004>ProjectRef('actio:task-1')).toBe(false);
  });
});
