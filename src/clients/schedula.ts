import { makeHttp } from './http.ts';
import {
  calendarEventsResponseSchema,
  personalEventsResponseSchema,
  schedulaEventsResponseSchema,
  type BusyEvent,
  freeBusyResponseSchema,
  calendarEventResponseSchema,
  calendarDeleteResponseSchema,
  calendarSyncResponseSchema,
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

export interface CalendarEventInput {
  calendarRef: string;
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  extendedProperties: { private: Record<string, string> };
}

function query(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const value = qs.toString();
  return value ? `?${value}` : '';
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
    async freeBusy(range: { from: string; to: string }) {
      return freeBusyResponseSchema.parse(await http.get<unknown>(`/api/calendar/freebusy${query({
        timeMin: range.from, timeMax: range.to,
      })}`));
    },
    async createCalendarEvent(input: CalendarEventInput) {
      return calendarEventResponseSchema.parse(await http.post<unknown>('/api/calendar/events', input)).event;
    },
    async patchCalendarEvent(id: string, input: CalendarEventInput) {
      return calendarEventResponseSchema.parse(await http.patch<unknown>(
        `/api/calendar/events/${encodeURIComponent(id)}`, input,
      )).event;
    },
    async deleteCalendarEvent(id: string, calendarRef: string) {
      return calendarDeleteResponseSchema.parse(await http.del<unknown>(
        `/api/calendar/events/${encodeURIComponent(id)}${query({ calendarRef })}`,
      ));
    },
    async pullCalendar() {
      return calendarSyncResponseSchema.parse(await http.post<unknown>('/api/calendar/sync'));
    },
  };
}

export type SchedulaClient = ReturnType<typeof makeSchedulaClient>;
