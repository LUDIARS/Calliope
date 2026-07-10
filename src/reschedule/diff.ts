export interface ComparablePlanEntry {
  taskRef: string;
  startAt: string | null;
  endAt: string | null;
  lane: string;
  isHumanGate: boolean;
}

export interface ComparablePlan {
  id: string;
  entries: ComparablePlanEntry[];
}

export interface MovedEntry {
  taskRef: string;
  before: ComparablePlanEntry;
  after: ComparablePlanEntry;
  direction: 'earlier' | 'later' | 'changed';
  laneChanged: boolean;
  humanGateMoved: boolean;
}

function time(value: string | null): number | null {
  if (value === null) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`invalid plan timestamp: ${value}`);
  return parsed;
}

export function comparePlans(before: ComparablePlan, after: ComparablePlan) {
  const beforeByRef = new Map(before.entries.map((entry) => [entry.taskRef, entry]));
  const afterByRef = new Map(after.entries.map((entry) => [entry.taskRef, entry]));
  const added = after.entries.filter((entry) => !beforeByRef.has(entry.taskRef));
  const removed = before.entries.filter((entry) => !afterByRef.has(entry.taskRef));
  const moved: MovedEntry[] = [];
  for (const previous of before.entries) {
    const next = afterByRef.get(previous.taskRef);
    if (!next) continue;
    if (previous.startAt === next.startAt && previous.endAt === next.endAt && previous.lane === next.lane) continue;
    const previousStart = time(previous.startAt);
    const nextStart = time(next.startAt);
    const direction = previousStart !== null && nextStart !== null
      ? nextStart < previousStart ? 'earlier' as const : nextStart > previousStart ? 'later' as const : 'changed' as const
      : 'changed' as const;
    moved.push({
      taskRef: previous.taskRef,
      before: previous,
      after: next,
      direction,
      laneChanged: previous.lane !== next.lane,
      humanGateMoved: previous.isHumanGate || next.isHumanGate,
    });
  }
  return {
    beforePlanId: before.id,
    afterPlanId: after.id,
    added,
    removed,
    moved,
    hasChanges: added.length > 0 || removed.length > 0 || moved.length > 0,
  };
}
