import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeActioClient } from '../actio.ts';
import { makeProjectHubClient } from '../projecthub.ts';
import { makeMemoriaClient } from '../memoria.ts';
import { makeSchedulaClient } from '../schedula.ts';
import { makeNuntiusClient } from '../nuntius.ts';
import { composeWeeklyRetrospective } from '../../retrospective/compose.ts';

type FetchCall = Parameters<typeof fetch>;

afterEach(() => {
  vi.restoreAllMocks();
});

function fixtureFor(url: string): unknown {
  if (url.endsWith('/api/tasks')) return { tasks: [] };
  if (url.endsWith('/api/pm/projects')) return { projects: [] };
  if (/\/api\/pm\/projects\/[^/]+\/tasks$/.test(url)) return { tasks: [] };
  if (/\/api\/pm\/tasks\/[^/]+\/history$/.test(url)) return { history: [] };
  if (url.endsWith('/analytics/gompertz')) {
    return {
      projectId: 'project 1', generatedAt: '2026-07-10T00:00:00.000Z',
      totalBugsFound: 0, totalBugsFixed: 0, estimatedTotalBugs: 0,
      convergenceDate: null, confidenceLevel: 0, dataPoints: [],
    };
  }
  if (url.endsWith('/analytics/critical-path')) {
    return {
      path: [], totalEstimatedDays: 0, projectedCompletionDate: '2026-07-10', riskLevel: 'low',
    };
  }
  if (url.includes('/api/events')) return { events: [] };
  if (url.includes('/api/calendar/events')) return { events: [], connected: true };
  if (url.endsWith('/api/calendar/personal')) return { events: [] };
  if (url.includes('/api/roadmaps')) return { lines: [] };
  if (url.includes('/api/goal-evals')) return [];
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
    await client.listPmTaskHistory('task 1');
    await client.getGompertz('project 1');
    await client.getCriticalPath('project 1');

    expect(fetchMock.mock.calls.map((call: FetchCall) => call[0])).toEqual([
      'http://actio.test/api/tasks',
      'http://actio.test/api/pm/projects',
      'http://actio.test/api/pm/projects/project%201/tasks',
      'http://actio.test/api/pm/tasks/task%201/history',
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

  it('publishes one aggregated briefing through the Nuntius topic contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => Response.json({
      topic: String(input).includes('calliope.weekly') ? 'calliope.weekly' : 'calliope.daily',
      delivered: 1,
      messages: [{ id: 'm1', userId: 'u1', channel: 'discord' }],
    }));
    const client = makeNuntiusClient({ baseUrl: 'http://nuntius.test', token: 'project-token' });
    const briefing = {
      date: '2026-07-11', generatedAt: '2026-07-10T23:00:00.000Z', planId: null,
      todayPlan: [], decisions: [], alerts: [], upcomingDeadlines: [], humanGates: [],
      stocktake: null,
      summary: { tasks: 0, decisions: 0, alerts: 0, humanGates: 0, stocktakeProposals: 0 },
    };
    await expect(client.publishDailyBriefing(briefing)).resolves.toMatchObject({ delivered: 1 });
    expect(fetchMock).toHaveBeenCalledWith('http://nuntius.test/api/topics/calliope.daily/publish', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer project-token' }),
      body: JSON.stringify({ payload: { kind: 'daily_briefing', briefing }, source: 'calliope.daily' }),
    }));
    const retrospective = composeWeeklyRetrospective({
      now: new Date('2026-07-15T00:00:00.000Z'), velocities: [], curves: [], priorities: [], logs: [],
    });
    await client.publishWeeklyRetrospective(retrospective);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://nuntius.test/api/topics/calliope.weekly/publish',
      expect.objectContaining({
        body: JSON.stringify({
          payload: { kind: 'weekly_retrospective', retrospective }, source: 'calliope.weekly',
        }),
      }),
    );
  });
});

describe('Schedula freeBusy', () => {
  it('uses the aggregate P4 freeBusy contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      busy: [{ start: '2026-07-13T00:00:00.000Z', end: '2026-07-13T01:00:00.000Z' }],
      connected: false,
      warnings: ['google_calendar_not_connected'],
    }));
    const client = makeSchedulaClient({ baseUrl: 'http://schedula.test', token: null });
    await expect(client.freeBusy({
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-14T00:00:00.000Z',
    })).resolves.toEqual({
      busy: [{ start: '2026-07-13T00:00:00.000Z', end: '2026-07-13T01:00:00.000Z' }],
      connected: false,
      warnings: ['google_calendar_not_connected'],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://schedula.test/api/calendar/freebusy?timeMin=2026-07-13T00%3A00%3A00.000Z&timeMax=2026-07-14T00%3A00%3A00.000Z',
    );
  });
});

describe('ProjectHub client', () => {
  const projectFixture = {
    id: 'proj-1',
    name: 'Example Game',
    description: null,
    status: 'active' as const,
    repoUrl: null,
    createdAt: 1752900000000,
    updatedAt: 1752900000000,
    members: [
      { userId: 'user-1', role: 'producer' as const, displayName: 'Producer One', createdAt: 1752900000000 },
    ],
  };

  it('reaches the real external projects paths with Cernere bearer + service token headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/external/projects')) return Response.json({ projects: [projectFixture] });
      if (url.endsWith('/external/projects/proj-1')) return Response.json({ project: projectFixture });
      throw new Error(`unexpected url: ${url}`);
    });
    const client = makeProjectHubClient({
      baseUrl: 'http://projecthub.test', token: 'cernere-bearer', serviceToken: 'svc-token',
    });

    await expect(client.listProjects()).resolves.toEqual([projectFixture]);
    await expect(client.getProject('proj-1')).resolves.toEqual(projectFixture);
    await expect(client.listMembers('proj-1')).resolves.toEqual(projectFixture.members);

    expect(fetchMock.mock.calls.map((call: FetchCall) => call[0])).toEqual([
      'http://projecthub.test/api/x/projects/external/projects',
      'http://projecthub.test/api/x/projects/external/projects/proj-1',
      'http://projecthub.test/api/x/projects/external/projects/proj-1',
    ]);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({
        headers: expect.objectContaining({
          'x-projecthub-service-token': 'svc-token',
          authorization: 'Bearer cernere-bearer',
        }),
      });
    }
  });

  it('encodes the project id in the path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ project: { ...projectFixture, id: 'proj 1' } }),
    );
    const client = makeProjectHubClient({ baseUrl: 'http://projecthub.test', token: null, serviceToken: 'svc-token' });

    await client.getProject('proj 1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://projecthub.test/api/x/projects/external/projects/proj%201');
  });

  it('rejects a response that violates the fixture contract', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ projects: [{ id: 'p1' }] }));
    const client = makeProjectHubClient({ baseUrl: 'http://projecthub.test', token: null, serviceToken: 'svc-token' });

    await expect(client.listProjects()).rejects.toThrow();
  });
});
