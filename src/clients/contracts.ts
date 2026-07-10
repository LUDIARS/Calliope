import { z } from 'zod';

const nullableIso = z.string().datetime({ offset: true }).nullable();
const priority = z.enum(['low', 'medium', 'med', 'high', 'critical']);

export const actioTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable().default(null),
  requirements: z.string().nullable().default(null),
  status: z.string(),
  kind: z.enum(['task', 'goal']).default('task'),
  creatorType: z.enum(['human', 'ai']).default('human'),
  category: z.string().nullable().default(null),
  priority: priority.default('medium'),
  deadline: nullableIso.default(null),
  estimatedMinutes: z.number().nonnegative().nullable().default(null),
  pluginId: z.string().nullable().default(null),
  pluginRef: z.string().nullable().default(null),
  completedAt: nullableIso.default(null),
  createdAt: z.string().datetime({ offset: true }),
});

export const pmProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});

export const pmTaskSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  externalId: z.string().min(1),
  title: z.string(),
  description: z.string().nullable().default(null),
  status: z.string(),
  priority: priority.default('medium'),
  labels: z.array(z.string()).default([]),
  dueDate: nullableIso.default(null),
  milestoneExternalId: z.string().nullable().default(null),
  milestoneName: z.string().nullable().default(null),
  estimatedHours: z.number().nonnegative().nullable().default(null),
  blockedBy: z.array(z.string()).default([]),
  createdAt: z.string().datetime({ offset: true }),
});

export const actioTasksResponseSchema = z.object({ tasks: z.array(actioTaskSchema) });
export const pmProjectsResponseSchema = z.object({ projects: z.array(pmProjectSchema) });
export const pmTasksResponseSchema = z.object({ tasks: z.array(pmTaskSchema) });

export const agentRunSchema = z.object({
  id: z.coerce.string().min(1),
  task_id: z.union([z.string(), z.number().transform(String)]).nullable(),
  project_id: z.union([z.string(), z.number().transform(String)]).nullable(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'cancelled']),
  started_at: z.string().datetime({ offset: true }),
  finished_at: nullableIso,
});

export const agentRunsResponseSchema = z.object({ items: z.array(agentRunSchema) });

const roadmapMemberSchema = z.object({
  repo: z.string().min(1),
  importance: z.number().min(1).max(3),
  lines: z.array(z.string()).optional(),
});

const roadmapLineSchema = z.object({
  repo: z.string().min(1),
  line: z.object({ id: z.string(), code: z.string(), title: z.string() }),
  members: z.array(roadmapMemberSchema),
});

export const roadmapsResponseSchema = z.object({ lines: z.array(roadmapLineSchema) });

export const schedulaEventsResponseSchema = z.object({
  events: z.array(z.object({
    startTime: z.string().datetime({ offset: true }),
    endTime: z.string().datetime({ offset: true }),
  })),
});

export const calendarEventsResponseSchema = z.object({
  events: z.array(z.object({
    start: z.string().min(1),
    end: z.string().min(1),
  })),
  connected: z.boolean().optional(),
});

export const personalEventsResponseSchema = z.object({
  events: z.array(z.object({
    day: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    duration: z.number().int().positive().default(1),
  })),
});

export type ActioTask = z.infer<typeof actioTaskSchema>;
export type PmProject = z.infer<typeof pmProjectSchema>;
export type PmTask = z.infer<typeof pmTaskSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type Roadmaps = z.infer<typeof roadmapsResponseSchema>;

export interface BusyEvent {
  start: string;
  end: string;
}
