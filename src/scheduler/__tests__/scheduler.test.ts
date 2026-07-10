import { describe, expect, it } from 'vitest';
import { DagCycleError, topologicalSort } from '../dag.ts';
import { listFreeSlots, mergeBusyIntervals, nextFreeSlot } from '../freebusy.ts';
import { listSchedule } from '../listSchedule.ts';

describe('DAG', () => {
  it('sorts dependencies before dependents', () => {
    const result = topologicalSort([
      { taskRef: 'b', blockedBy: ['a'] },
      { taskRef: 'a', blockedBy: [] },
    ]);
    expect(result.map((task) => task.taskRef)).toEqual(['a', 'b']);
  });

  it('throws the cycle task refs', () => {
    expect(() => topologicalSort([
      { taskRef: 'a', blockedBy: ['b'] },
      { taskRef: 'b', blockedBy: ['a'] },
    ])).toThrow(DagCycleError);
    try {
      topologicalSort([
        { taskRef: 'a', blockedBy: ['b'] },
        { taskRef: 'b', blockedBy: ['a'] },
      ]);
    } catch (error) {
      expect((error as DagCycleError).taskRefs).toEqual(['a', 'b', 'a']);
    }
  });
});

describe('freebusy', () => {
  const range = { from: '2026-07-13T00:00:00.000Z', to: '2026-07-13T08:00:00.000Z' };

  it('clips and merges overlapping intervals', () => {
    expect(mergeBusyIntervals([
      { start: '2026-07-12T23:00:00.000Z', end: '2026-07-13T02:00:00.000Z' },
      { start: '2026-07-13T01:00:00.000Z', end: '2026-07-13T03:00:00.000Z' },
    ], range)).toEqual([
      { start: '2026-07-13T00:00:00.000Z', end: '2026-07-13T03:00:00.000Z' },
    ]);
  });

  it('enumerates free slots around busy time', () => {
    expect(listFreeSlots([
      { start: '2026-07-13T02:00:00.000Z', end: '2026-07-13T03:00:00.000Z' },
    ], range)).toEqual([
      { start: '2026-07-13T00:00:00.000Z', end: '2026-07-13T02:00:00.000Z' },
      { start: '2026-07-13T03:00:00.000Z', end: '2026-07-13T08:00:00.000Z' },
    ]);
  });

  it('finds a slot inside JST business hours', () => {
    expect(nextFreeSlot([
      { start: '2026-07-12T23:00:00.000Z', end: '2026-07-13T09:00:00.000Z' },
    ], '2026-07-12T23:00:00.000Z', 30, {
      startHour: 9,
      endHour: 18,
      utcOffsetMinutes: 540,
    })).toEqual({
      start: '2026-07-13T00:00:00.000Z',
      end: '2026-07-13T00:30:00.000Z',
    });
  });
});

describe('listSchedule', () => {
  it('honors dependencies while assigning earliest AI lanes', () => {
    const entries = listSchedule([
      { taskRef: 'a', blockedBy: [], durationMinutes: 60, priority: 0.5, confidence: 0.5, isHumanGate: false },
      { taskRef: 'b', blockedBy: ['a'], durationMinutes: 60, priority: 1, confidence: 0.5, isHumanGate: false },
      { taskRef: 'c', blockedBy: [], durationMinutes: 60, priority: 1, confidence: 0.5, isHumanGate: false },
    ], {
      lanes: 2,
      startAt: '2026-07-13T00:00:00.000Z',
      humanFreeSlots: [],
    });
    const a = entries.find((entry) => entry.taskRef === 'a');
    const b = entries.find((entry) => entry.taskRef === 'b');
    expect(new Date(b?.startAt ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(a?.endAt ?? 0).getTime());
    expect(new Set(entries.filter((entry) => !entry.isHumanGate).map((entry) => entry.lane)).size).toBe(2);
  });

  it('places human gates in business hours or marks them pending', () => {
    const task = {
      taskRef: 'gate',
      blockedBy: [],
      durationMinutes: 30,
      priority: 1,
      confidence: 0.2,
      isHumanGate: true,
    };
    const scheduled = listSchedule([task], {
      lanes: 1,
      startAt: '2026-07-12T23:00:00.000Z',
      humanFreeSlots: [{ start: '2026-07-12T23:00:00.000Z', end: '2026-07-13T09:00:00.000Z' }],
    });
    expect(scheduled[0]).toMatchObject({ lane: 'human', startAt: '2026-07-13T00:00:00.000Z' });
    expect(listSchedule([task], {
      lanes: 1,
      startAt: '2026-07-12T23:00:00.000Z',
      humanFreeSlots: null,
    })[0]).toMatchObject({ lane: 'human-pending', startAt: null, endAt: null });
  });
});