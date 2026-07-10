import type { ActioClient } from '../clients/actio.ts';
import type { MemoriaClient } from '../clients/memoria.ts';
import type { CalliopeRepository, PriorityScope } from '../db/repository.ts';
import { isCompletedStatus, loadPlanningTasks, type PlanningTask } from '../planning/tasks.ts';
import { normalizePriority, scorePriority, type PriorityOverrides } from './score.ts';

export interface PriorityEngineDeps {
  actio: ActioClient;
  memoria: MemoriaClient;
  repo: CalliopeRepository;
  now?: () => Date;
}

function roadmapImportance(roadmaps: Awaited<ReturnType<MemoriaClient['getRoadmaps']>>): Map<string, number> {
  const importance = new Map<string, number>();
  for (const line of roadmaps.lines) {
    const lineImportance = Math.max(0, ...line.members.map((member) => member.importance));
    importance.set(line.line.code.toLowerCase(), lineImportance);
    importance.set(line.line.id.toLowerCase(), lineImportance);
    importance.set(line.repo.toLowerCase(), lineImportance);
    for (const member of line.members) {
      importance.set(member.repo.toLowerCase(), member.importance);
    }
  }
  return importance;
}

function findImportance(projectRef: string, values: Map<string, number>): number {
  return values.get(projectRef.toLowerCase()) ?? 0;
}

function matchingGoal(task: PlanningTask, goals: PlanningTask[]): PlanningTask | null {
  return goals
    .filter((goal) => goal.category === task.category)
    .sort((a, b) => normalizePriority(b.priority) - normalizePriority(a.priority))[0] ?? null;
}

function overridesFromBreakdown(value: unknown): PriorityOverrides | undefined {
  if (!value || typeof value !== 'object' || !('override' in value)) return undefined;
  const override = (value as { override?: unknown }).override;
  return override && typeof override === 'object' ? override as PriorityOverrides : undefined;
}

function goalProgressUrgency(status: 'todo' | 'doing' | 'done', now: Date): number {
  const observed = status === 'done' ? 1 : status === 'doing' ? 0.5 : 0;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.max(now.getUTCDate() / daysInMonth - observed, 0);
}

export function makePriorityEngine(deps: PriorityEngineDeps) {
  return {
    async refresh() {
      const now = deps.now?.() ?? new Date();
      const [tasks, roadmaps, existingRows, goalEvals] = await Promise.all([
        loadPlanningTasks(deps.actio),
        deps.memoria.getRoadmaps(),
        deps.repo.listPriorities(),
        deps.memoria.getGoalEvals(now.toISOString().slice(0, 7)),
      ]);
      const nowIso = now.toISOString();
      const importance = roadmapImportance(roadmaps);
      const existing = new Map(existingRows.map((row) => [`${row.scope}:${row.ref}`, row]));
      const goals = tasks.filter((task) => task.kind === 'goal' && !isCompletedStatus(task.status));
      const latestEvalByGoal = new Map<string, (typeof goalEvals)[number]>();
      for (const item of goalEvals) {
        const previous = latestEvalByGoal.get(item.goal_id);
        if (!previous || item.date > previous.date) latestEvalByGoal.set(item.goal_id, item);
      }
      const progressUrgencyByGoal = new Map(goals.map((goal) => {
        const evaluation = latestEvalByGoal.get(goal.sourceId);
        return [goal.taskRef, evaluation ? goalProgressUrgency(evaluation.status, now) : 0] as const;
      }));
      const activeTasks = tasks.filter((task) => !isCompletedStatus(task.status));
      const activeRefs = new Set(activeTasks.map((task) => task.taskRef));
      let projects = 0;
      let goalCount = 0;
      let taskCount = 0;

      const projectRefs = new Set(activeTasks.map((task) => task.projectRef));
      for (const projectRef of projectRefs) {
        const previous = existing.get(`project:${projectRef}`);
        const scored = scorePriority({
          projectImportance: findImportance(projectRef, importance),
          now,
          firstReadyAt: previous?.firstReadyAt,
          overrides: overridesFromBreakdown(previous?.breakdown),
        });
        await deps.repo.upsertPriority({
          scope: 'project',
          ref: projectRef,
          ...scored,
          firstReadyAt: previous?.firstReadyAt ?? nowIso,
          updatedAt: nowIso,
        });
        projects += 1;
      }

      for (const goal of goals) {
        const previous = existing.get(`goal:${goal.taskRef}`);
        const scored = scorePriority({
          projectImportance: findImportance(goal.projectRef, importance),
          goalPriority: goal.priority,
          dueAt: goal.dueAt,
          goalProgressUrgency: progressUrgencyByGoal.get(goal.taskRef),
          now,
          firstReadyAt: previous?.firstReadyAt,
          overrides: overridesFromBreakdown(previous?.breakdown),
        });
        await deps.repo.upsertPriority({
          scope: 'goal',
          ref: goal.taskRef,
          ...scored,
          firstReadyAt: previous?.firstReadyAt ?? nowIso,
          updatedAt: nowIso,
        });
        goalCount += 1;
      }

      for (const task of activeTasks) {
        const scope: PriorityScope = task.kind === 'goal' ? 'goal' : 'task';
        if (scope === 'goal') continue;
        const previous = existing.get(`task:${task.taskRef}`);
        const goal = matchingGoal(task, goals);
        const isReady = task.blockedBy.every((dependency) => !activeRefs.has(dependency));
        const firstReadyAt = previous?.firstReadyAt ?? (isReady ? nowIso : null);
        const scored = scorePriority({
          projectImportance: findImportance(task.projectRef, importance),
          goalPriority: goal?.priority,
          taskPriority: task.priority,
          dueAt: task.dueAt,
          goalProgressUrgency: goal ? progressUrgencyByGoal.get(goal.taskRef) : undefined,
          now,
          firstReadyAt,
          overrides: overridesFromBreakdown(previous?.breakdown),
        });
        await deps.repo.upsertPriority({
          scope: 'task',
          ref: task.taskRef,
          ...scored,
          firstReadyAt,
          updatedAt: nowIso,
        });
        taskCount += 1;
      }

      return { projects, goals: goalCount, tasks: taskCount, updated_at: nowIso };
    },
  };
}
