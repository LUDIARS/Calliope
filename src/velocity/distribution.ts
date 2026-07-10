import { z } from 'zod';

export const velocityDistributionSchema = z.object({
  p25: z.number().nonnegative(),
  p50: z.number().nonnegative(),
  p75: z.number().nonnegative(),
}).passthrough();

export type VelocityDistribution = z.infer<typeof velocityDistributionSchema>;

export function parseVelocityDistribution(value: unknown): VelocityDistribution | null {
  const parsed = velocityDistributionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function velocityConfidence(sampleSize: number, value: unknown): number {
  const distribution = parseVelocityDistribution(value);
  if (!distribution || distribution.p50 <= 0 || sampleSize < 0) return 0.2;
  const sampleConfidence = sampleSize / (sampleSize + 5);
  const spread = Math.max(distribution.p75 - distribution.p25, 0);
  const spreadPenalty = 1 - Math.min(spread / distribution.p50, 1);
  return sampleConfidence * spreadPenalty;
}

export function estimateP80Factor(value: unknown, fallback: number): number {
  const distribution = parseVelocityDistribution(value);
  if (!distribution) return fallback;
  // IQR only is persisted. This extrapolates p80 from p50→p75 using normal quantile spacing.
  const normalP80ToP75 = 0.841621 / 0.67449;
  return Math.max(distribution.p75, distribution.p50 +
    normalP80ToP75 * Math.max(distribution.p75 - distribution.p50, 0));
}
