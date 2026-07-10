import type { EstimateSource, NewVelocity } from '../db/repository.ts';
import { calculateAccuracy } from './accuracy.ts';

export const DEFAULT_VELOCITY_WINDOW_DAYS = 28;
const SHRINKAGE_PRIOR_SAMPLES = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACCURACY_WINDOW_DAYS = 7;

export interface VelocitySample {
  taskRef: string;
  category: string;
  projectRef: string;
  estimateMinutes: number;
  actualMinutes: number;
  completedAt: string;
  estimateSource?: EstimateSource;
}

export interface VelocityCalculationOptions {
  windowDays?: number;
  windowEnd?: Date;
}

function quantile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('quantile requires at least one value');
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

function groupKey(projectRef: string, category: string): string {
  return `${projectRef}\u0000${category}`;
}

function addGroup(groups: Map<string, VelocitySample[]>, projectRef: string, category: string, sample: VelocitySample) {
  const key = groupKey(projectRef, category);
  const values = groups.get(key) ?? [];
  values.push(sample);
  groups.set(key, values);
}

export function calculateVelocity(
  samples: VelocitySample[],
  options: VelocityCalculationOptions = {},
): NewVelocity[] {
  const windowDays = options.windowDays ?? DEFAULT_VELOCITY_WINDOW_DAYS;
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw new Error('windowDays must be a positive integer');
  const windowEndDate = options.windowEnd ?? new Date();
  const windowStartDate = new Date(windowEndDate.getTime() - windowDays * MS_PER_DAY);
  const eligible = samples.filter((sample) => {
    const completedAt = new Date(sample.completedAt).getTime();
    return sample.estimateMinutes > 0 && sample.actualMinutes >= 0 &&
      completedAt >= windowStartDate.getTime() && completedAt <= windowEndDate.getTime();
  });
  if (eligible.length === 0) return [];

  const globalRatios = eligible.map((sample) => sample.actualMinutes / sample.estimateMinutes);
  const globalK = globalRatios.length >= SHRINKAGE_PRIOR_SAMPLES ? median(globalRatios) : 1;
  const groups = new Map<string, VelocitySample[]>();
  for (const sample of eligible) {
    addGroup(groups, sample.projectRef, sample.category, sample);
    addGroup(groups, sample.projectRef, '*', sample);
    addGroup(groups, '*', sample.category, sample);
    addGroup(groups, '*', '*', sample);
  }

  const windowStart = windowStartDate.toISOString();
  const windowEnd = windowEndDate.toISOString();
  const accuracyStart = windowEndDate.getTime() - ACCURACY_WINDOW_DAYS * MS_PER_DAY;
  return [...groups.entries()].map(([key, group]) => {
    const [projectRef = '*', category = '*'] = key.split('\u0000');
    const ratios = group.map((sample) => sample.actualMinutes / sample.estimateMinutes);
    const rawK = median(ratios);
    const kFactor = projectRef === '*'
      ? rawK
      : (group.length * rawK + SHRINKAGE_PRIOR_SAMPLES * globalK) /
        (group.length + SHRINKAGE_PRIOR_SAMPLES);
    return {
      id: `velocity:${encodeURIComponent(projectRef)}:${encodeURIComponent(category)}:${windowStart}:${windowEnd}`,
      projectRef,
      category,
      windowStart,
      windowEnd,
      kFactor,
      throughput: group.reduce((sum, sample) => sum + sample.estimateMinutes, 0) / windowDays,
      distribution: {
        p25: quantile(ratios, 0.25),
        p50: quantile(ratios, 0.5),
        p75: quantile(ratios, 0.75),
        accuracyBySource: calculateAccuracy(group.filter((sample) =>
          new Date(sample.completedAt).getTime() >= accuracyStart)),
      },
      sampleSize: group.length,
      source: 'actio+memoria',
    };
  });
}
