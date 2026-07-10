import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeActioClient } from '../actio.ts';
import { makeMemoriaClient } from '../memoria.ts';
import { makeSchedulaClient } from '../schedula.ts';

type FetchCall = Parameters<typeof fetch>;

afterEach(() => {
  vi.restoreAllMocks();
});

function fixtureFor(url: string): unknown {
  if (url.endsWith('/api/tasks')) return { tasks: [] };
  if (url.endsWith('/api/pm/projects')) return { projects: [] };
  if (/\/api\/pm\/projects\/[^/]+\/tasks$/.test(url)) return { tasks: [] };
  if (url.includes('/api/events')) return { events: [] };
  if (url.includes('/api/calendar/events')) return { events: [], connected: true };
  if (url.endsWith('/api/calendar/personal')) return { events: [] };
  if (url.includes('/api/roadmaps')) return { lines: [] };
  if (url.includes('/api/agent-runs')) return { items: [] };
  return { ok: true };
}

function mockJson() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
    Promise.resolve(new Response(JSON.stringify(fixtureFor(String(input))), { status: 200 })),
  );
}

describe('upstream connectors', () => {
  it('uses real Actio paths', async () => {
    const fetchMock = mockJson();
    const client = makeActioClient({ baseUrl: 'http://actio.test', token: null });

    await client.listTasks();
    await client.listPmProjects();
    await client.listPmTasks('project 1');
    await client.getGompertz('project 1');
    await client.getCriticalPath('project 1');

    expect(fetchMock.mock.calls.map((call: FetchCall) => call[0])).toEqual([
      'http://actio.test/api/tasks',
      'http://actio.test/api/pm/projects',
      'http://actio.test/api/pm/projects/project%201/tasks',
      'http://actio.test/api/pm/projects/project%201/analytics/gompertz',
      'http://actio.test/api/pm/projects/project%201/analytics/critical-path',
    ]);
  });

  it('uses real Schedula paths', async () => {
    const fetchMock = mockJson();
    const client = makeSchedulaClient({ baseUrl: 'http://schedula.test', token: null });

    await client.listEvents({ from: '2026-07-01', to: '2026-07-02' });
    await client.listCalendarEvents({ from: '2026-07-01', to: '2026-07-02', maxResults: 10 });
    await client.listPersonalEvents();

    expect(fetchMock.mock.calls.map((call: FetchCall) => call[0])).toEqual([
      'http://schedula.test/api/events?from=2026-07-01&to=2026-07-02',
      'http://schedula.test/api/calendar/events?timeMin=2026-07-01&timeMax=2026-07-02&maxResults=10',
      'http://schedula.test/api/calendar/personal',
    ]);
  });

  it('uses real Memoria paths', async () => {
    const fetchMock = mockJson();
    const client = makeMemoriaClient({ baseUrl: 'http://memoria.test', token: null });

    await client.getRoadmaps('2026-07');
    await client.getGoalEvals('2026-07');
    await client.listAgentRuns({ taskId: '1', projectId: '2', limit: 3 });

    expect(fetchMock.mock.calls.map((call: FetchCall) => call[0])).toEqual([
      'http://memoria.test/api/roadmaps?month=2026-07',
      'http://memoria.test/api/goal-evals?month=2026-07',
      'http://memoria.test/api/agent-runs?task_id=1&project_id=2&limit=3',
    ]);
  });
});

describe('Schedula freeBusy', () => {
  it('projects Monday personal events into absolute JST intervals', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/events')) return Response.json({ events: [] });
      return Response.json({
        events: [{ day: 0, startTime: '09:00', endTime: '10:00', duration: 1 }],
      });
    });
    const client = makeSchedulaClient({ baseUrl: 'http://schedula.test', token: null });
    await expect(client.freeBusy({
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
    })).resolves.toEqual([
      { start: '2026-07-13T00:00:00.000Z', end: '2026-07-13T01:00:00.000Z' },
    ]);
  });
});