import type { ActioClient } from '../clients/actio.ts';
import type { ActioTask, PmTask } from '../clients/contracts.ts';
import { make<private-reference-004>ProjectRef, makeTaskRef } from '../refs.ts';

export interface PlanningTask {
  taskRef: string;
  sourceId: string;
  legacyTaskId: string | null;
  projectRef: string;
  category: string;
  labels: string[];
  title: string;
  details: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  estimateMinutes: number | null;
  completedAt: string | null;
  createdAt: string;
  kind: 'task' | 'goal';
  blockedBy: string[];
  isHumanGate: boolean;
}

export function isCompletedStatus(status: string): boolean {
  return ['done', 'closed', 'cancelled'].includes(status.toLowerCase());
}

export function projectRefForActioTask(task: ActioTask): string {
  // <private-reference-004> 紐付けタスク (Actio tasks.project_id = <private-reference-004>_project.id 不透明参照、
  // docs/design/<private-reference-004>-pm.md H1 最終裁定) は category/pluginId より優先して
  // <private-reference-004>:<project_id> scope に載せる (既存 category/pluginId ベースの挙動は
  // project_id 未設定タスクでは不変)。
  const <private-reference-004>ProjectId = task.projectId?.trim();
  if (<private-reference-004>ProjectId) return make<private-reference-004>ProjectRef(<private-reference-004>ProjectId);
  return task.category?.trim() || task.pluginId?.trim() || 'actio';
}

export function toCorePlanningTask(task: ActioTask): PlanningTask {
  const category = task.category?.trim() || 'uncategorized';
  return {
    taskRef: makeTaskRef('actio', task.id),
    sourceId: task.id,
    legacyTaskId: task.pluginRef,
    projectRef: projectRefForActioTask(task),
    category,
    labels: category.split(',').map((label) => label.trim()).filter(Boolean),
    title: task.title,
    details: task.description ?? task.requirements,
    status: task.status,
    priority: task.priority,
    dueAt: task.deadline,
    estimateMinutes: task.estimatedMinutes,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    kind: task.kind,
    blockedBy: [],
    isHumanGate: task.kind === 'goal',
  };
}

function toPmPlanningTasks(projectId: string, projectName: string, tasks: PmTask[]): PlanningTask[] {
  const byIdentifier = new Map<string, string>();
  for (const task of tasks) {
    const ref = makeTaskRef('actio-pm', projectId, task.externalId);
    byIdentifier.set(task.id, ref);
    byIdentifier.set(task.externalId, ref);
  }

  return tasks.map((task) => ({
    taskRef: makeTaskRef('actio-pm', projectId, task.externalId),
    sourceId: task.id,
    legacyTaskId: null,
    projectRef: projectName || projectId,
    category: projectName || projectId,
    labels: task.labels,
    title: task.title,
    details: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueDate,
    estimateMinutes: task.estimatedHours === null ? null : task.estimatedHours * 60,
    completedAt: isCompletedStatus(task.status) ? task.createdAt : null,
    createdAt: task.createdAt,
    kind: 'task',
    blockedBy: task.blockedBy.map((id) => byIdentifier.get(id)).filter((ref): ref is string => ref !== undefined),
    isHumanGate: task.labels.some((label) => label.toLowerCase() === 'human-gate'),
  }));
}

export async function loadPlanningTasks(actio: ActioClient): Promise<PlanningTask[]> {
  const [coreTasks, projects] = await Promise.all([actio.listTasks(), actio.listPmProjects()]);
  const pmTasks = await Promise.all(projects.map(async (project) =>
    toPmPlanningTasks(project.id, project.name, await actio.listPmTasks(project.id))));
  return [...coreTasks.map(toCorePlanningTask), ...pmTasks.flat()];
}
