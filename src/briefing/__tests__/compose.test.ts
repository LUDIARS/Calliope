import { describe, expect, it } from 'vitest';
import { composeDailyBriefing } from '../compose.ts';

describe('daily briefing composition', () => {
  it('uses the JST day and aggregates decisions, health, deadlines, and human gates', () => {
    const briefing = composeDailyBriefing({
      now: new Date('2026-07-10T23:00:00.000Z'),
      plan: { id: 'plan-1', entries: [
        { taskRef: 'actio:1', startAt: '2026-07-10T22:30:00.000Z', endAt: '2026-07-10T23:30:00.000Z', lane: 'human', seq: 0, isHumanGate: true },
        { taskRef: 'actio:2', startAt: '2026-07-10T01:00:00.000Z', endAt: '2026-07-10T02:00:00.000Z', lane: 'ai-1', seq: 0, isHumanGate: false },
      ] },
      sprints: [{
        id: 'sprint-1', projectRef: 'actio:p1', goalRef: 'actio:g1', periodEnd: '2026-07-17',
        latestCurve: { gompertzParams: { health: { status: 'at_risk' } } },
      }],
      confirmations: [
        { id: 'pending', kind: 'reschedule', expiresAt: '2026-07-11T01:00:00.000Z' },
        { id: 'expired', kind: 'calendar_write', expiresAt: '2026-07-10T22:00:00.000Z' },
      ],
      risks: [{ goalRef: 'actio:g1', projectedCompletion: '2026-07-20', deadline: '2026-07-15', level: 'red' }],
    });
    expect(briefing.date).toBe('2026-07-11');
    expect(briefing.todayPlan).toHaveLength(1);
    expect(briefing.todayPlan[0]?.lane).toBe('human');
    expect(briefing.decisions.map((item) => item.id)).toEqual(['pending']);
    expect(briefing.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'sprint_at_risk', sprintId: 'sprint-1' }),
      expect.objectContaining({ type: 'goal_risk', level: 'red' }),
    ]));
    expect(briefing.upcomingDeadlines).toEqual([expect.objectContaining({ goalRef: 'actio:g1' })]);
    expect(briefing.humanGates).toEqual([expect.objectContaining({ taskRef: 'actio:1' })]);
  });

  it('surfaces the task generation candidate count from a live task_create confirmation (§G2)', () => {
    const summary = {
      sprintCarryover: 1, riskRed: 1, planGap: 0, retrospectiveAction: 0,
      candidates: 2, suppressed: 3,
    };
    const briefing = composeDailyBriefing({
      now: new Date('2026-07-10T23:00:00.000Z'),
      plan: null,
      sprints: [],
      confirmations: [
        {
          id: 'gen-1', kind: 'task_create', expiresAt: '2026-07-11T20:00:00.000Z',
          payload: { generatedAt: '2026-07-10T22:30:00.000Z', summary, candidates: [] },
        },
        {
          id: 'gen-expired', kind: 'task_create', expiresAt: '2026-07-10T22:00:00.000Z',
          payload: { generatedAt: '2026-07-09T00:00:00.000Z', summary, candidates: [] },
        },
      ],
      risks: [],
    });
    expect(briefing.taskGeneration).toEqual({ confirmationId: 'gen-1', ...summary });
    expect(briefing.summary.taskGenerationCandidates).toBe(2);
  });

  it('reports no task generation section when nothing is pending', () => {
    const briefing = composeDailyBriefing({
      now: new Date('2026-07-10T23:00:00.000Z'), plan: null, sprints: [], confirmations: [], risks: [],
    });
    expect(briefing.taskGeneration).toBeNull();
    expect(briefing.summary.taskGenerationCandidates).toBe(0);
  });
});
