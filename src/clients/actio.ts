import { makeHttp } from './http.ts';

export interface ActioClientOptions {
  baseUrl: string;
  token: string | null;
}

export function makeActioClient(opts: ActioClientOptions) {
  const http = makeHttp({ baseUrl: opts.baseUrl, token: opts.token, service: 'actio' });

  return {
    health: () => http.get<unknown>('/api/health'),
    listTasks: () => http.get<unknown>('/api/tasks'),
    listPmProjects: () => http.get<unknown>('/api/pm/projects'),
    listPmTasks: (projectId: string) => http.get<unknown>(`/api/pm/projects/${encodeURIComponent(projectId)}/tasks`),
    getGompertz: (projectId: string) =>
      http.get<unknown>(`/api/pm/projects/${encodeURIComponent(projectId)}/analytics/gompertz`),
    getCriticalPath: (projectId: string) =>
      http.get<unknown>(`/api/pm/projects/${encodeURIComponent(projectId)}/analytics/critical-path`),
  };
}

export type ActioClient = ReturnType<typeof makeActioClient>;
