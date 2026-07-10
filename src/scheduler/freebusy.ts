export interface TimeInterval {
  start: string;
  end: string;
}

export interface TimeRange {
  from: string;
  to: string;
}

export interface BusinessHours {
  startHour: number;
  endHour: number;
  utcOffsetMinutes?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function asDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${label}: ${value}`);
  return date;
}

export function mergeBusyIntervals(events: TimeInterval[], range: TimeRange): TimeInterval[] {
  const from = asDate(range.from, 'range.from').getTime();
  const to = asDate(range.to, 'range.to').getTime();
  if (to <= from) throw new Error('range.to must be after range.from');
  const clipped = events.flatMap((event) => {
    const start = Math.max(asDate(event.start, 'event.start').getTime(), from);
    const end = Math.min(asDate(event.end, 'event.end').getTime(), to);
    return end > start ? [{ start, end }] : [];
  }).sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of clipped) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  return merged.map((interval) => ({
    start: new Date(interval.start).toISOString(),
    end: new Date(interval.end).toISOString(),
  }));
}

export function listFreeSlots(events: TimeInterval[], range: TimeRange): TimeInterval[] {
  const busy = mergeBusyIntervals(events, range);
  const to = asDate(range.to, 'range.to').getTime();
  let cursor = asDate(range.from, 'range.from').getTime();
  const free: TimeInterval[] = [];
  for (const interval of busy) {
    const start = new Date(interval.start).getTime();
    if (start > cursor) free.push({ start: new Date(cursor).toISOString(), end: interval.start });
    cursor = Math.max(cursor, new Date(interval.end).getTime());
  }
  if (cursor < to) free.push({ start: new Date(cursor).toISOString(), end: new Date(to).toISOString() });
  return free;
}

function nextBusinessCandidate(
  freeStart: number,
  freeEnd: number,
  from: number,
  duration: number,
  business: BusinessHours,
): TimeInterval | null {
  const offset = (business.utcOffsetMinutes ?? 0) * 60_000;
  let localDay = Math.floor((Math.max(freeStart, from) + offset) / MS_PER_DAY);
  while (localDay * MS_PER_DAY - offset < freeEnd) {
    const dayStart = localDay * MS_PER_DAY - offset;
    const businessStart = dayStart + business.startHour * 60 * 60 * 1000;
    const businessEnd = dayStart + business.endHour * 60 * 60 * 1000;
    const start = Math.max(freeStart, from, businessStart);
    const end = start + duration;
    if (end <= Math.min(freeEnd, businessEnd)) {
      return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    }
    localDay += 1;
  }
  return null;
}

export function nextFreeSlot(
  freeSlots: TimeInterval[],
  from: string,
  minutes: number,
  business?: BusinessHours,
): TimeInterval | null {
  if (minutes <= 0) throw new Error('minutes must be positive');
  const fromMs = asDate(from, 'from').getTime();
  const duration = minutes * 60_000;
  for (const slot of freeSlots) {
    const freeStart = asDate(slot.start, 'slot.start').getTime();
    const freeEnd = asDate(slot.end, 'slot.end').getTime();
    if (business) {
      const candidate = nextBusinessCandidate(freeStart, freeEnd, fromMs, duration, business);
      if (candidate) return candidate;
      continue;
    }
    const start = Math.max(freeStart, fromMs);
    if (start + duration <= freeEnd) {
      return { start: new Date(start).toISOString(), end: new Date(start + duration).toISOString() };
    }
  }
  return null;
}