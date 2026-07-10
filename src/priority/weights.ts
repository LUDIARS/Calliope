export const PRIORITY_WEIGHTS = {
  project: 0.35,
  goal: 0.25,
  task: 0.20,
  urgency: 0.15,
  aging: 0.05,
} as const;

export const PRIORITY_HORIZON_DAYS = 30;
export const AGING_MAX_DAYS = 14;
