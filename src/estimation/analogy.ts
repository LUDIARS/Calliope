export interface AnalogyTarget {
  category: string;
  labels: string[];
}

export interface AnalogySample {
  category: string;
  labels: string[];
  actualMinutes: number;
}

export interface AnalogyEstimate {
  effortMinutes: number;
  confidence: number;
  sampleSize: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function sharesLabel(target: AnalogyTarget, sample: AnalogySample): boolean {
  const labels = new Set(target.labels.map((label) => label.toLowerCase()));
  return sample.labels.some((label) => labels.has(label.toLowerCase()));
}

export function estimateByAnalogy(target: AnalogyTarget, samples: AnalogySample[]): AnalogyEstimate | null {
  const sameCategory = samples.filter((sample) =>
    sample.category === target.category && sample.actualMinutes > 0);
  if (sameCategory.length < 3) return null;
  const labelMatches = sameCategory.filter((sample) => sharesLabel(target, sample));
  const selected = labelMatches.length >= 3 ? labelMatches : sameCategory;
  return {
    effortMinutes: Math.round(median(selected.map((sample) => sample.actualMinutes))),
    confidence: selected.length / (selected.length + 5),
    sampleSize: selected.length,
  };
}
