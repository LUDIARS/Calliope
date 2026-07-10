import type { EstimateSource } from '../db/repository.ts';

export interface AccuracySample {
  estimateMinutes: number;
  actualMinutes: number;
  estimateSource?: EstimateSource;
}

export interface AccuracyMetric {
  mape: number;
  bias: number;
  sampleSize: number;
}

export function calculateAccuracy(samples: AccuracySample[]): Partial<Record<EstimateSource, AccuracyMetric>> {
  const sources: EstimateSource[] = ['human', 'analogy', 'llm'];
  const result: Partial<Record<EstimateSource, AccuracyMetric>> = {};
  for (const source of sources) {
    const matching = samples.filter((sample) =>
      sample.estimateSource === source && sample.estimateMinutes > 0 && sample.actualMinutes >= 0);
    if (matching.length === 0) continue;
    const relativeErrors = matching.map((sample) =>
      (sample.actualMinutes - sample.estimateMinutes) / sample.estimateMinutes);
    result[source] = {
      mape: relativeErrors.reduce((sum, value) => sum + Math.abs(value), 0) / matching.length,
      bias: relativeErrors.reduce((sum, value) => sum + value, 0) / matching.length,
      sampleSize: matching.length,
    };
  }
  return result;
}
