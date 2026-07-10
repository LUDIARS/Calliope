import { makeHttp } from './http.ts';
import {
  actioTasksResponseSchema,
  pmProjectsResponseSchema,
  pmTasksResponseSchema,
} from './contracts.ts';

export interface ActioClientOptions {
  baseUrl: string;
  token: string | null;
}

export function makeActioClient(opts: ActioClientOptions) {
  const http = makeHttp({ baseUrl: opts.baseUrl, token: opts.token, service: 'actio' });

  return {
    health: () => http.get<unknown>('/api/health'),
    listTasks: async () => actioTasksResponseSchema.parse(await http.get<unknown>('/api/tasks')).tasks,
    listPmProjects: async () => pmProjectsResponseSchema.parse(await http.get<unknown>('/api/pm/projects')).projects,
    listPmTasks: async (projectId: string) => pmTasksResponseSchema.parse(
      await http.get<unknown>(`/api/pm/projects/${encodeURIComponent(projectId)}/tasks`),
    ).tasks,
    getGompertz: (projectId: string) =>
      http.get<unknown>(`/api/pm/projects/${encodeURIComponent(projectId)}/analytics/gompertz`),
    getCriticalPath: (projectId: string) =>
      http.get<unknown>(`/api/pm/projects/${encodeURIComponent(projectId)}/analytics/critical-path`),
  };
}

export type ActioClient = ReturnType<typeof makeActioClient>;
