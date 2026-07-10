import { makeHttp } from './http.ts';
import {
  calendarEventsResponseSchema,
  personalEventsResponseSchema,
  schedulaEventsResponseSchema,
  type BusyEvent,
} from './contracts.ts';

export interface SchedulaClientOptions {
  baseUrl: string;
  token: string | null;
}

export interface EventRange {
  from?: string;
  to?: string;
  maxResults?: number;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function query(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const value = qs.toString();
  return value ? `?${value}` : '';
}

function minutesFromMidnight(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function expandPersonalEvents(
  events: Array<{ day: number; startTime: string | null; endTime: string | null; duration: number }>,
  range: { from: string; to: string },
): BusyEvent[] {
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  let localDay = Math.floor((from + JST_OFFSET_MS) / MS_PER_DAY);
  const expanded: BusyEvent[] = [];
  while (localDay * MS_PER_DAY - JST_OFFSET_MS < to) {
    const localCalendarDate = new Date(localDay * MS_PER_DAY);
    const mondayBasedDay = (localCalendarDate.getUTCDay() + 6) % 7;
    const dayStart = localDay * MS_PER_DAY - JST_OFFSET_MS;
    for (const event of events) {
      if (mondayBasedDay !== event.day || !event.startTime) continue;
      const start = dayStart + minutesFromMidnight(event.startTime) * 60_000;
      const end = event.endTime
        ? dayStart + minutesFromMidnight(event.endTime) * 60_000
        : start + event.duration * 60 * 60 * 1000;
      if (end > from && start < to) {
        expanded.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      }
    }
    localDay += 1;
  }
  return expanded;
}

export function makeSchedulaClient(opts: SchedulaClientOptions) {
  const http = makeHttp({ baseUrl: opts.baseUrl, token: opts.token, service: 'schedula' });

  return {
    health: () => http.get<unknown>('/api/health'),
    listEvents: async (range: EventRange = {}) => schedulaEventsResponseSchema.parse(
      await http.get<unknown>(`/api/events${query({ from: range.from, to: range.to, maxResults: range.maxResults })}`),
    ).events.map((event) => ({ start: event.startTime, end: event.endTime })),
    listCalendarEvents: async (range: EventRange = {}) => calendarEventsResponseSchema.parse(
      await http.get<unknown>(`/api/calendar/events${query({
        timeMin: range.from,
        timeMax: range.to,
        maxResults: range.maxResults,
      })}`),
    ).events.map((event) => ({ start: event.start, end: event.end })),
    listPersonalEvents: async () => personalEventsResponseSchema.parse(
      await http.get<unknown>('/api/calendar/personal'),
    ).events,
    getCalendarStatus: () => http.get<unknown>('/api/calendar/status'),
    async freeBusy(range: { from: string; to: string }): Promise<BusyEvent[]> {
      const [events, personalEvents] = await Promise.all([
        schedulaEventsResponseSchema.parse(
          await http.get<unknown>(`/api/events${query({ from: range.from, to: range.to })}`),
        ).events,
        personalEventsResponseSchema.parse(await http.get<unknown>('/api/calendar/personal')).events,
      ]);
      return [
        ...events.map((event) => ({ start: event.startTime, end: event.endTime })),
        ...expandPersonalEvents(personalEvents, range),
      ];
    },
  };
}

export type SchedulaClient = ReturnType<typeof makeSchedulaClient>;