// sprint/engine.ts (Actio PM scope) と sprint/projecthub-engine.ts (projecthub:<id> scope) の
// 両方で使う、スコープに依存しない純粋ヘルパー。

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_SPRINT_DAYS = 14;

export function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max((to.getTime() - from.getTime()) / MS_PER_DAY, 0);
}

export function goalProgressFromStatus(status: 'todo' | 'doing' | 'done'): number {
  if (status === 'done') return 1;
  if (status === 'doing') return 0.5;
  return 0;
}
