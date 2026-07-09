import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeActioClient } from '../actio.ts';
import { makeMemoriaClient } from '../memoria.ts';
import { makeSchedulaClient } from '../schedula.ts';

type FetchCall = Parameters<typeof fetch>;

afterEach(() => {
  vi.restoreAllMocks();
});

function mockJson() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
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
