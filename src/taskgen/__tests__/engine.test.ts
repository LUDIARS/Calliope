import { describe, expect, it } from 'vitest';
import {
  buildExistingTaskIndex,
  composeTaskGenerationReport,
  dedupeCandidates,
  detectPlanGaps,
  detectRetrospectiveActions,
  detectRiskRedFollowUps,
  detectSprintCarryover,
  latestRiskByGoal,
  type CarryoverSprintView,
  type GoalRiskView,
} from '../engine.ts';

const NOW = new Date('2026-07-21T00:00:00.000Z');

function sprint(overrides: Partial<CarryoverSprintView> & { id: string }): CarryoverSprintView {
  return {
    projectRef: 'p1',
    goalRef: 'actio:goal-1',
    periodEnd: '2026-07-14T00:00:00.000Z',
    status: 'closed',
    tasks: [],
    ...overrides,
  };
}

function risk(overrides: Partial<GoalRiskView> & { goalRef: string }): GoalRiskView {
  return {
    date: '2026-07-20',
    level: 'red',
    deadline: '2026-07-31T00:00:00.000Z',
    projectedCompletion: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('task generation detection engine', () => {
  it('detects carryover only from closed sprints and committed tasks', () => {
    const candidates = detectSprintCarryover([
      sprint({ id: 's1', tasks: [
        { taskRef: 'actio:1', status: 'committed' },
        { taskRef: 'actio:2', status: 'completed' },
        { taskRef: 'actio:3', status: 'removed' },
      ] }),
      sprint({ id: 's2', status: 'active', tasks: [{ taskRef: 'actio:4', status: 'committed' }] }),
    ]);
    expect(candidates.map((c) => c.originTaskRef)).toEqual(['actio:1']);
    expect(candidates[0]).toMatchObject({
      source: 'sprint_carryover',
      key: 'sprint_carryover|actio:1',
      externalId: 'calliope-taskgen-sprint-carryover-actio-1',
      category: 'p1',
      dueAt: null,
    });
  });

  it('drops projecthub project refs from the Actio category (opaque reference)', () => {
    const candidates = detectSprintCarryover([
      sprint({ id: 's1', projectRef: 'projecthub:abc', tasks: [{ taskRef: 'actio:9', status: 'committed' }] }),
    ]);
    expect(candidates[0]?.category).toBeNull();
    expect(candidates[0]?.projectRef).toBe('projecthub:abc');
  });

  it('keeps only the latest snapshot per goal and proposes follow-ups for red goals', () => {
    const risks = [
      risk({ goalRef: 'actio:goal-1', date: '2026-07-19', level: 'red' }),
      risk({ goalRef: 'actio:goal-1', date: '2026-07-20', level: 'amber' }),
      risk({ goalRef: 'actio:goal-2', date: '2026-07-20', level: 'red' }),
    ];
    expect(latestRiskByGoal(risks).map((item) => `${item.goalRef}:${item.level}`).sort())
      .toEqual(['actio:goal-1:amber', 'actio:goal-2:red']);

    const candidates = detectRiskRedFollowUps(risks);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      source: 'risk_red',
      goalRef: 'actio:goal-2',
      title: 'Risk mitigation for actio:goal-2',
      dueAt: '2026-07-31T00:00:00.000Z',
    });
  });

  it('does not pass a non-instant deadline through as due_at', () => {
    const candidates = detectRiskRedFollowUps([risk({ goalRef: 'actio:goal-3', deadline: '2026-07-31' })]);
    expect(candidates[0]?.dueAt).toBeNull();
    expect(candidates[0]?.reason).toContain('deadline 2026-07-31');
  });

  it('maps active plan entries and retrospective recommendations into candidates', () => {
    expect(detectPlanGaps([{ planId: 'plan-1', taskRef: 'actio:77', lane: 'lane-a' }])[0]).toMatchObject({
      source: 'plan_gap',
      originTaskRef: 'actio:77',
      title: 'Restore planned task actio:77',
    });
    expect(detectRetrospectiveActions([{ code: 'review_velocity_weights', message: 'k-factor moved' }])[0])
      .toMatchObject({
        source: 'retrospective_action',
        title: 'Retrospective action: review_velocity_weights',
        reason: 'k-factor moved',
      });
  });

  it('suppresses candidates whose task_ref or normalized title already exists in Actio', () => {
    const candidates = [
      ...detectPlanGaps([
        { planId: 'plan-1', taskRef: 'actio:1', lane: 'a' },
        { planId: 'plan-1', taskRef: 'actio:2', lane: 'b' },
      ]),
      ...detectRetrospectiveActions([{ code: 'review_sprint_scope', message: 'scope creep' }]),
    ];
    const index = buildExistingTaskIndex([
      { taskRef: 'actio:1', title: 'Whatever' },
      { taskRef: 'actio:50', title: 'retrospective  action:  REVIEW_SPRINT_SCOPE' },
    ]);
    const result = dedupeCandidates(candidates, index, new Set());
    expect(result.candidates.map((c) => c.key)).toEqual(['plan_gap|actio:2']);
    expect(result.suppressed).toEqual([
      { key: 'plan_gap|actio:1', source: 'plan_gap', reason: 'existing_task_ref' },
      { key: 'retrospective_action|review_sprint_scope', source: 'retrospective_action', reason: 'existing_title' },
    ]);
  });

  it('suppresses re-proposals of candidate keys already held by a confirmation', () => {
    const candidates = detectPlanGaps([{ planId: 'plan-1', taskRef: 'actio:5', lane: 'a' }]);
    const result = dedupeCandidates(
      candidates,
      buildExistingTaskIndex([]),
      new Set(['plan_gap|actio:5']),
    );
    expect(result.candidates).toEqual([]);
    expect(result.suppressed[0]).toMatchObject({ reason: 'open_confirmation' });
  });

  it('composes all four sources and reports the suppressed breakdown', () => {
    const report = composeTaskGenerationReport({
      now: NOW,
      sprints: [sprint({ id: 's1', tasks: [
        { taskRef: 'actio:missing', status: 'committed' },
        { taskRef: 'actio:alive', status: 'committed' },
      ] })],
      risks: [risk({ goalRef: 'actio:goal-2' })],
      planEntries: [{ planId: 'plan-1', taskRef: 'actio:missing', lane: 'a' }],
      retrospectiveActions: [{ code: 'review_velocity_weights', message: 'k-factor moved' }],
      existingTasks: [{ taskRef: 'actio:alive', title: 'Alive task' }],
      reservedCandidateKeys: new Set(),
    });
    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.summary).toEqual({
      sprintCarryover: 1,
      riskRed: 1,
      planGap: 1,
      retrospectiveAction: 1,
      candidates: 4,
      suppressed: 1,
    });
    // actio:alive は Actio に存在するので carryover 候補にならない。
    expect(report.suppressed).toEqual([
      { key: 'sprint_carryover|actio:alive', source: 'sprint_carryover', reason: 'existing_task_ref' },
    ]);
    // carryover と plan gap は同じ task_ref でも別系統の候補として両方残る (タイトルが違う)。
    expect(report.candidates.map((c) => c.key)).toEqual([
      'sprint_carryover|actio:missing',
      'risk_red|actio:goal-2',
      'plan_gap|actio:missing',
      'retrospective_action|review_velocity_weights',
    ]);
  });
});
