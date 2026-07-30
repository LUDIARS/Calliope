import { describe, expect, it } from 'vitest';
import {
  composeStocktakeReport,
  detectAging,
  detectDoneCandidates,
  detectDuplicateCandidates,
  detectPriorityStaleness,
  scoreToPriority,
  type StocktakeTask,
} from '../engine.ts';

const NOW = new Date('2026-07-21T00:00:00.000Z');

function task(overrides: Partial<StocktakeTask> & { id: string }): StocktakeTask {
  return {
    title: `Task ${overrides.id}`,
    status: 'open',
    priority: 'medium',
    projectRef: 'p1',
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('stocktake detection engine', () => {
  it('detects aging tasks past the threshold and sorts by age', () => {
    const findings = detectAging([
      task({ id: '1', updatedAt: daysAgo(30) }),
      task({ id: '2', updatedAt: daysAgo(20) }),
      task({ id: '3', updatedAt: daysAgo(3) }),
    ], NOW, 14);
    expect(findings.map((f) => f.taskId)).toEqual(['1', '2']);
    expect(findings[0]).toMatchObject({ taskId: '1', ageDays: 30 });
  });

  it('detects done candidates by cross-referencing done task refs', () => {
    const findings = detectDoneCandidates(
      [task({ id: '10' }), task({ id: '11' })],
      new Set(['actio:10']),
    );
    expect(findings).toEqual([{ taskId: '10', title: 'Task 10' }]);
  });

  it('detects duplicate candidates via normalized title within the same project', () => {
    const findings = detectDuplicateCandidates([
      task({ id: '20', title: 'Refactor Auth Module', projectRef: 'p1' }),
      task({ id: '21', title: 'refactor  auth   module!', projectRef: 'p1' }),
      task({ id: '22', title: 'Refactor Auth Module', projectRef: 'p2' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ taskIds: ['20', '21'], projectRef: 'p1' });
  });

  it('detects priority staleness when the resolved bucket diverges past the gap', () => {
    const findings = detectPriorityStaleness(
      [
        task({ id: '30', priority: 'low' }),
        task({ id: '31', priority: 'high' }),
        task({ id: '32', priority: 'medium' }),
      ],
      new Map([
        ['actio:30', 0.9], // critical vs low → gap 3
        ['actio:31', 0.8], // high vs high → gap 0
        // 32 has no resolved score → ignored
      ]),
      2,
    );
    expect(findings).toEqual([
      { taskId: '30', title: 'Task 30', actioPriority: 'low', resolvedPriority: 'critical', gap: 3 },
    ]);
  });

  it('maps resolved scores to Actio priority buckets', () => {
    expect(scoreToPriority(0.1)).toBe('low');
    expect(scoreToPriority(0.5)).toBe('medium');
    expect(scoreToPriority(0.8)).toBe('high');
    expect(scoreToPriority(0.95)).toBe('critical');
  });

  it('composes a report with close/reprioritize/merge proposals (aging is report-only)', () => {
    const report = composeStocktakeReport({
      now: NOW,
      tasks: [
        task({ id: '1', title: 'Old task', priority: 'low', updatedAt: daysAgo(30) }),
        task({ id: '2', title: 'Finished work' }),
        task({ id: '3', title: 'Dup title', projectRef: 'p1' }),
        task({ id: '4', title: 'dup title', projectRef: 'p1' }),
      ],
      doneTaskRefs: new Set(['actio:2']),
      resolvedPriorityByRef: new Map([['actio:1', 0.95]]),
    }, { agingDays: 14, priorityGap: 2 });

    expect(report.summary).toEqual({
      aging: 1,
      doneCandidates: 1,
      duplicateCandidates: 1,
      priorityStaleness: 1,
      proposals: 3,
    });
    expect(report.proposals).toEqual([
      { action: 'close', taskId: '2', title: 'Finished work', reason: 'done_candidate' },
      { action: 'reprioritize', taskId: '1', title: 'Old task', priority: 'critical', reason: 'priority_staleness' },
      { action: 'merge', taskIds: ['3', '4'], title: 'Dup title', reason: 'duplicate_candidate' },
    ]);
  });
});
