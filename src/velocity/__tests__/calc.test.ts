import { describe, expect, it } from 'vitest';
import { calculateVelocity, type VelocitySample } from '../calc.ts';

const windowEnd = new Date('2026-07-10T00:00:00.000Z');

function sample(
  projectRef: string,
  category: string,
  ratio: number,
  estimateMinutes = 60,
): VelocitySample {
  return {
    taskRef: `actio:${projectRef}-${category}-${ratio}`,
    projectRef,
    category,
    estimateMinutes,
    actualMinutes: estimateMinutes * ratio,
    completedAt: '2026-07-09T00:00:00.000Z',
    estimateSource: 'human',
  };
}

describe('calculateVelocity', () => {
  it('shrinks small project samples toward the global prior and emits sentinel rows', () => {
    const rows = calculateVelocity([
      sample('p1', 'code', 2),
      sample('p2', 'code', 1),
    ], { windowEnd });
    const exact = rows.find((row) => row.projectRef === 'p1' && row.category === 'code');
    expect(exact?.kFactor).toBeCloseTo((2 + 5) / 6);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectRef: 'p1', category: '*' }),
      expect.objectContaining({ projectRef: '*', category: 'code' }),
      expect.objectContaining({ projectRef: '*', category: '*' }),
    ]));
  });

  it('uses a cross-project median when at least five samples exist', () => {
    const rows = calculateVelocity([
      sample('p1', 'code', 4),
      sample('p2', 'code', 1),
      sample('p3', 'code', 1),
      sample('p4', 'code', 1),
      sample('p5', 'code', 1),
    ], { windowEnd });
    const exact = rows.find((row) => row.projectRef === 'p1' && row.category === 'code');
    expect(exact?.kFactor).toBeCloseTo((4 + 5 * 1) / 6);
  });

  it('calculates throughput, IQR, and source accuracy', () => {
    const rows = calculateVelocity([
      sample('p1', 'code', 1),
      sample('p1', 'code', 2),
      sample('p1', 'code', 3),
      sample('p1', 'code', 4),
    ], { windowEnd, windowDays: 28 });
    const row = rows.find((value) => value.projectRef === 'p1' && value.category === 'code');
    expect(row?.throughput).toBeCloseTo(240 / 28);
    expect(row?.distribution).toMatchObject({
      p25: 1.75,
      p50: 2.5,
      p75: 3.25,
      accuracyBySource: {
        human: { sampleSize: 4 },
      },
    });
  });
});