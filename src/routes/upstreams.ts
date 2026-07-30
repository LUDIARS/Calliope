import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

export interface UpstreamRoutesDeps {
  clients: CalliopeClients;
}

function requireClient<T>(service: string, client: T | null): T {
  if (!client) throw unconfigured(service);
  return client;
}

export function mountUpstreamRoutes(app: Hono, deps: UpstreamRoutesDeps) {
  app.get('/api/upstreams/actio/tasks', async (c) => {
    try {
      return c.json(await requireClient('actio', deps.clients.actio).listTasks());
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/actio/pm/projects', async (c) => {
    try {
      return c.json(await requireClient('actio', deps.clients.actio).listPmProjects());
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/actio/pm/projects/:projectId/tasks', async (c) => {
    try {
      return c.json(await requireClient('actio', deps.clients.actio).listPmTasks(c.req.param('projectId')));
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/actio/pm/projects/:projectId/gompertz', async (c) => {
    try {
      return c.json(await requireClient('actio', deps.clients.actio).getGompertz(c.req.param('projectId')));
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/actio/pm/projects/:projectId/critical-path', async (c) => {
    try {
      return c.json(await requireClient('actio', deps.clients.actio).getCriticalPath(c.req.param('projectId')));
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/schedula/events', async (c) => {
    try {
      return c.json(await requireClient('schedula', deps.clients.schedula).listEvents({
        from: c.req.query('from'),
        to: c.req.query('to'),
      }));
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/schedula/calendar/events', async (c) => {
    try {
      return c.json(await requireClient('schedula', deps.clients.schedula).listCalendarEvents({
        from: c.req.query('from'),
        to: c.req.query('to'),
        maxResults: c.req.query('maxResults') ? Number(c.req.query('maxResults')) : undefined,
      }));
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/schedula/calendar/personal', async (c) => {
    try {
      return c.json(await requireClient('schedula', deps.clients.schedula).listPersonalEvents());
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/memoria/roadmaps', async (c) => {
    try {
      return c.json(await requireClient('memoria', deps.clients.memoria).getRoadmaps(c.req.query('month')));
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/memoria/goal-evals', async (c) => {
    try {
      return c.json(await requireClient('memoria', deps.clients.memoria).getGoalEvals(c.req.query('month')));
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/memoria/agent-runs', async (c) => {
    try {
      return c.json(await requireClient('memoria', deps.clients.memoria).listAgentRuns({
        taskId: c.req.query('task_id'),
        projectId: c.req.query('project_id'),
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      }));
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/projecthub/projects', async (c) => {
    try {
      return c.json(await requireClient('projecthub', deps.clients.projecthub).listProjects());
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/projecthub/projects/:projectId', async (c) => {
    try {
      return c.json(await requireClient('projecthub', deps.clients.projecthub).getProject(c.req.param('projectId')));
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  app.get('/api/upstreams/projecthub/projects/:projectId/members', async (c) => {
    try {
      return c.json(await requireClient('projecthub', deps.clients.projecthub).listMembers(c.req.param('projectId')));
    } catch (error) {
      return upstreamFailure(error);
    }
  });
}
