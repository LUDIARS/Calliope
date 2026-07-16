import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.ts';
import type { CalliopeConfig } from '../../config.ts';
import { makeActioClient } from '../actio.ts';
import { UpstreamError } from '../http.ts';

const taskFixture = {
  id: 'task-1',
  title: 'Prepare weekly review',
  description: 'Collect the latest project signals',
  requirements: null,
  status: 'open',
  kind: 'goal',
  creatorType: 'ai',
  category: 'Calliope',
  priority: 'medium',
  deadline: '2026-07-20T00:00:00.000Z',
  estimatedMinutes: null,
  pluginId: null,
  pluginRef: null,
  completedAt: null,
  createdAt: '2026-07-17T00:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

function unconfiguredConfig(): CalliopeConfig {
  return {
    port: 0,
    dbPath: ':memory:',
    agentLanes: 3,
    serviceToken: null,
    llmEstimation: false,
    actio: { baseUrl: null, token: null },
    schedula: { baseUrl: null, token: null },
    memoria: { baseUrl: null, token: null },
    concordiaBaseUrl: null,
    nuntiusBaseUrl: null,
    claudeBin: 'claude',
  };
}

describe('Actio write client', () => {
  it('creates tasks with the Memoria-compatible Actio contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ task: taskFixture }, { status: 201 }),
    );
    const client = makeActioClient({ baseUrl: 'http://actio.test/', token: 'service-token' });

    await expect(client.createTask({
      external_id: 'calliope-confirmation-42',
      title: taskFixture.title,
      details: taskFixture.description,
      due_at: taskFixture.deadline,
      kind: 'goal',
      category: 'Calliope',
    })).resolves.toEqual(taskFixture);

    expect(fetchMock).toHaveBeenCalledWith('http://actio.test/api/tasks', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: 'Bearer service-token',
      },
      body: JSON.stringify({
        source: 'calliope',
        external_id: 'calliope-confirmation-42',
        title: taskFixture.title,
        details: taskFixture.description,
        status: 'open',
        due_at: taskFixture.deadline,
        kind: 'goal',
        category: 'Calliope',
        creator_type: 'ai',
      }),
    });
  });

  it('updates status and priority through the existing task PATCH endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const patch = JSON.parse(String(init?.body)) as { status?: string; priority?: string };
      return Response.json({ task: { ...taskFixture, ...patch } });
    });
    const client = makeActioClient({ baseUrl: 'http://actio.test', token: null });

    await expect(client.updateTaskStatus('task/1', 'done')).resolves.toMatchObject({ status: 'done' });
    await expect(client.updateTaskPriority('task/1', 'high')).resolves.toMatchObject({ priority: 'high' });

    expect(fetchMock.mock.calls.map(([input, init]) => [input, init?.method, init?.body])).toEqual([
      ['http://actio.test/api/tasks/task%2F1', 'PATCH', JSON.stringify({ status: 'done' })],
      ['http://actio.test/api/tasks/task%2F1', 'PATCH', JSON.stringify({ priority: 'high' })],
    ]);
  });

  it('throws on Actio 4xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid task', { status: 400 }));
    const client = makeActioClient({ baseUrl: 'http://actio.test', token: null });

    await expect(client.createTask({
      external_id: 'calliope-confirmation-42',
      title: 'Invalid task',
    })).rejects.toMatchObject({
      service: 'actio',
      path: '/api/tasks',
      status: 400,
    } satisfies Partial<UpstreamError>);
  });

  it('keeps the existing 503 actio_unconfigured behavior', async () => {
    const app = createApp(unconfiguredConfig());
    const response = await app.request('/api/upstreams/actio/tasks');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'actio_unconfigured' });
  });
});
