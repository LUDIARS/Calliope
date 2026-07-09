import { makeHttp } from './http.ts';

export interface MemoriaClientOptions {
  baseUrl: string;
  token: string | null;
}

export interface AgentRunQuery {
  taskId?: string;
  projectId?: string;
  limit?: number;
}

function query(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const value = qs.toString();
  return value ? `?${value}` : '';
}

export function makeMemoriaClient(opts: MemoriaClientOptions) {
  const http = makeHttp({ baseUrl: opts.baseUrl, token: opts.token, service: 'memoria' });

  return {
    health: () => http.get<unknown>('/api/health'),
    getRoadmaps: (month?: string) => http.get<unknown>(`/api/roadmaps${query({ month })}`),
    getGoalEvals: (month?: string) => http.get<unknown>(`/api/goal-evals${query({ month })}`),
    listAgentRuns: (params: AgentRunQuery = {}) =>
      http.get<unknown>(`/api/agent-runs${query({
        task_id: params.taskId,
        project_id: params.projectId,
        limit: params.limit,
      })}`),
  };
}

export type MemoriaClient = ReturnType<typeof makeMemoriaClient>;
