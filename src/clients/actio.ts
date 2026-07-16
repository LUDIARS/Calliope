import { makeHttp } from './http.ts';
import {
  actioCreateTaskInputSchema,
  actioTaskPrioritySchema,
  actioTaskResponseSchema,
  actioTaskStatusSchema,
  actioTasksResponseSchema,
  criticalPathSchema,
  gompertzReportSchema,
  pmProjectsResponseSchema,
  pmTaskHistoryResponseSchema,
  pmTasksResponseSchema,
} from './contracts.ts';
import type {
  ActioCreateTaskInput,
  ActioTaskPriority,
  ActioTaskStatus,
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
    createTask: async (input: ActioCreateTaskInput) => {
      const task = actioCreateTaskInputSchema.parse(input);
      return actioTaskResponseSchema.parse(await http.post<unknown>('/api/tasks', {
        source: 'calliope',
        external_id: task.external_id,
        title: task.title,
        details: task.details,
        status: task.status,
        due_at: task.due_at,
        kind: task.kind,
        category: task.category,
        creator_type: task.creator_type,
      })).task;
    },
    updateTaskStatus: async (taskId: string, status: ActioTaskStatus) => actioTaskResponseSchema.parse(
      await http.patch<unknown>(`/api/tasks/${encodeURIComponent(taskId)}`, {
        status: actioTaskStatusSchema.parse(status),
      }),
    ).task,
    updateTaskPriority: async (taskId: string, priority: ActioTaskPriority) => actioTaskResponseSchema.parse(
      await http.patch<unknown>(`/api/tasks/${encodeURIComponent(taskId)}`, {
        priority: actioTaskPrioritySchema.parse(priority),
      }),
    ).task,
    listPmProjects: async () => pmProjectsResponseSchema.parse(await http.get<unknown>('/api/pm/projects')).projects,
    listPmTasks: async (projectId: string) => pmTasksResponseSchema.parse(
      await http.get<unknown>(`/api/pm/projects/${encodeURIComponent(projectId)}/tasks`),
    ).tasks,
    listPmTaskHistory: async (taskId: string) => pmTaskHistoryResponseSchema.parse(
      await http.get<unknown>(`/api/pm/tasks/${encodeURIComponent(taskId)}/history`),
    ).history,
    getGompertz: async (projectId: string) => gompertzReportSchema.parse(
      await http.get<unknown>(`/api/pm/projects/${encodeURIComponent(projectId)}/analytics/gompertz`),
    ),
    getCriticalPath: async (projectId: string) => criticalPathSchema.parse(
      await http.get<unknown>(`/api/pm/projects/${encodeURIComponent(projectId)}/analytics/critical-path`),
    ),
  };
}

export type ActioClient = ReturnType<typeof makeActioClient>;
