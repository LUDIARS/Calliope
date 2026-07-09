import { makeHttp } from './http.ts';

export interface SchedulaClientOptions {
  baseUrl: string;
  token: string | null;
}

export interface EventRange {
  from?: string;
  to?: string;
  maxResults?: number;
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
    listEvents: (range: EventRange = {}) =>
      http.get<unknown>(`/api/events${query({ from: range.from, to: range.to, maxResults: range.maxResults })}`),
    listCalendarEvents: (range: EventRange = {}) =>
      http.get<unknown>(`/api/calendar/events${query({
        timeMin: range.from,
        timeMax: range.to,
        maxResults: range.maxResults,
      })}`),
    listPersonalEvents: () => http.get<unknown>('/api/calendar/personal'),
    getCalendarStatus: () => http.get<unknown>('/api/calendar/status'),
  };
}

export type SchedulaClient = ReturnType<typeof makeSchedulaClient>;
