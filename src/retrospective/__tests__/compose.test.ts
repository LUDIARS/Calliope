import { describe, expect, it } from 'vitest';
import { composeWeeklyRetrospective } from '../compose.ts';

describe('weekly retrospective composition', () => {
  it('aggregates drift, scope creep, aging, accuracy, and reschedule outcomes', () => {
    const result = composeWeeklyRetrospective({
      now: new Date('2026-07-15T03:00:00.000Z'),
      velocities: [
        { projectRef: 'p1', category: '*', windowEnd: '2026-07-14', kFactor: 1.3, distribution: {
          accuracyBySource: { human: { mape: 0.6, bias: 0.2, sampleSize: 3 } },
        } },
        { projectRef: 'p1', category: '*', windowEnd: '2026-07-07', kFactor: 1, distribution: {} },
      ],
      curves: [{
        sprintId: 's1', date: '2026-07-14',
        gompertzParams: { health: { scopeCreepRate: 0.2 } },
      }],
      priorities: [{ ref: 'actio:1', breakdown: { aging: 0.4 } }],
      logs: [{ trigger: 'daily', outcome: 'applied', createdAt: '2026-07-14T00:00:00.000Z' }],
    });
    expect(result.velocityDrift[0]?.changeRatio).toBeCloseTo(0.3);
    expect(result.scopeCreep).toEqual({ averageRate: 0.2, sampledSprints: 1 });
    expect(result.starvation).toEqual([{ ref: 'actio:1', aging: 0.4 }]);
    expect(result.estimationAccuracy[0]).toMatchObject({ source: 'human', mape: 0.6 });
    expect(result.reschedules.applied).toBe(1);
    expect(result.recommendations.map((item) => item.code)).toEqual([
      'review_velocity_weights', 'review_sprint_scope', 'review_priority_weights', 'review_estimation_source',
    ]);
  });
});
