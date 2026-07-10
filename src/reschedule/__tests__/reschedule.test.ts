import { describe, expect, it } from 'vitest';
import { comparePlans } from '../diff.ts';
import { assessRescheduleRisk } from '../risk.ts';

describe('plan diff and autonomy risk', () => {
  const before = {
    id: 'before',
    entries: [{
      taskRef: 'actio:1', startAt: '2026-07-11T00:00:00.000Z', endAt: '2026-07-11T01:00:00.000Z',
      lane: 'ai-1', isHumanGate: false,
    }],
  };

  it('classifies unstarted same-project reordering as low risk', () => {
    const diff = comparePlans(before, {
      id: 'after',
      entries: [{ ...before.entries[0]!, startAt: '2026-07-12T00:00:00.000Z', endAt: '2026-07-12T01:00:00.000Z' }],
    });
    expect(diff.moved[0]?.direction).toBe('later');
    expect(assessRescheduleRisk(diff, {
      now: new Date('2026-07-10T00:00:00.000Z'),
      tasks: [{ taskRef: 'actio:1', projectRef: 'p1', dueAt: null }],
      triggerProjectRef: 'p1',
    }).level).toBe('low');
  });

  it('requires confirmation for deadline slip, running cross-project preemption, or human gate movement', () => {
    const diff = comparePlans({
      id: 'before',
      entries: [{ ...before.entries[0]!, isHumanGate: true }],
    }, {
      id: 'after',
      entries: [{
        ...before.entries[0]!, isHumanGate: true,
        startAt: '2026-07-11T02:00:00.000Z', endAt: '2026-07-11T03:00:00.000Z',
      }],
    });
    const risk = assessRescheduleRisk(diff, {
      now: new Date('2026-07-11T00:30:00.000Z'),
      tasks: [{ taskRef: 'actio:1', projectRef: 'p2', dueAt: '2026-07-11T02:30:00.000Z' }],
      triggerProjectRef: 'p1',
    });
    expect(risk.level).toBe('high');
    expect(risk.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      'human_gate_moved', 'running_cross_project_preempted', 'cross_project_reallocation', 'deadline_slip',
    ]));
  });

  it('does not auto-apply removal from committed scope', () => {
    const diff = comparePlans(before, { id: 'after', entries: [] });
    expect(assessRescheduleRisk(diff, {
      now: new Date('2026-07-10T00:00:00.000Z'),
      tasks: [{ taskRef: 'actio:1', projectRef: 'p1', dueAt: null }],
      triggerProjectRef: 'p1',
    })).toMatchObject({ level: 'high', reasons: [{ code: 'scope_removed', taskRef: 'actio:1' }] });
  });
});
