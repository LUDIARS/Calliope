import { and, asc, desc, eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { curveSnapshot, sprint, sprintTask } from '../schema.ts';

export type SprintStatus = 'planned' | 'active' | 'closed';
export type SprintTaskStatus = 'committed' | 'completed' | 'removed';

export interface NewSprint {
  id: string;
  projectRef: string;
  goalRef?: string | null;
  periodStart: string;
  periodEnd: string;
  targetVelocity: number;
  gompertzSnapshot: unknown;
  status?: SprintStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

export interface NewSprintTask {
  id: string;
  sprintId: string;
  taskRef: string;
  effortMinutes: number;
  priorityScore: number;
  status?: SprintTaskStatus;
  statusHistory: unknown;
  committedAt: string;
  completedAt?: string | null;
}

export interface CurveSnapshotInput {
  id: string;
  sprintId: string;
  date: string;
  gompertzParams: unknown;
  inflowLambda: number;
  burndownActual: number;
  burndownPlanned: number;
  createdAt: string;
}

export interface SprintTaskStateInput {
  taskRef: string;
  status: SprintTaskStatus;
  sourceStatus: string;
}

export function makeSprintRepository(db: CalliopeDb) {
  return {
    async createSprintWithTasks(input: NewSprint, tasks: NewSprintTask[]) {
      db.transaction((tx) => {
        tx.insert(sprint).values({
          ...input,
          goalRef: input.goalRef ?? null,
          status: input.status ?? 'planned',
          closedAt: input.closedAt ?? null,
        }).run();
        if (tasks.length > 0) tx.insert(sprintTask).values(tasks.map((task) => ({
          ...task,
          status: task.status ?? 'committed',
          completedAt: task.completedAt ?? null,
        }))).run();
      });
    },

    async listSprints(filter: { projectRef?: string; status?: SprintStatus } = {}) {
      const rows = await db.select().from(sprint).orderBy(desc(sprint.periodStart));
      return rows.filter((row) =>
        (filter.projectRef === undefined || row.projectRef === filter.projectRef) &&
        (filter.status === undefined || row.status === filter.status));
    },

    async getSprint(id: string) {
      const rows = await db.select().from(sprint).where(eq(sprint.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async getSprintWithTasks(id: string) {
      const rows = await db.select().from(sprint).where(eq(sprint.id, id)).limit(1);
      const found = rows[0];
      if (!found) return null;
      const tasks = await db.select().from(sprintTask)
        .where(eq(sprintTask.sprintId, id))
        .orderBy(desc(sprintTask.priorityScore), asc(sprintTask.taskRef));
      const curves = await db.select().from(curveSnapshot)
        .where(eq(curveSnapshot.sprintId, id))
        .orderBy(asc(curveSnapshot.date));
      return { ...found, tasks, curveSnapshots: curves };
    },

    async activateSprint(id: string, updatedAt: string) {
      return db.transaction((tx) => {
        const target = tx.select().from(sprint).where(eq(sprint.id, id)).get();
        if (!target) throw new Error(`sprint not found: ${id}`);
        if (target.status !== 'planned') throw new Error(`sprint is not planned: ${id}`);
        const existing = tx.select().from(sprint).where(and(
          eq(sprint.projectRef, target.projectRef),
          eq(sprint.status, 'active'),
        )).get();
        if (existing) throw new Error(`active sprint exists: ${existing.id}`);
        tx.update(sprint).set({ status: 'active', updatedAt }).where(eq(sprint.id, id)).run();
        return { ...target, status: 'active' as const, updatedAt };
      });
    },

    async closeSprint(id: string, closedAt: string) {
      return db.transaction((tx) => {
        const target = tx.select().from(sprint).where(eq(sprint.id, id)).get();
        if (!target) throw new Error(`sprint not found: ${id}`);
        if (target.status !== 'active') throw new Error(`sprint is not active: ${id}`);
        tx.update(sprint).set({ status: 'closed', updatedAt: closedAt, closedAt })
          .where(eq(sprint.id, id)).run();
        return { ...target, status: 'closed' as const, updatedAt: closedAt, closedAt };
      });
    },

    async recordSprintTaskStates(sprintId: string, states: SprintTaskStateInput[], recordedAt: string) {
      db.transaction((tx) => {
        for (const state of states) {
          const row = tx.select().from(sprintTask).where(and(
            eq(sprintTask.sprintId, sprintId),
            eq(sprintTask.taskRef, state.taskRef),
          )).get();
          if (!row || row.status === state.status) continue;
          if (!Array.isArray(row.statusHistory)) {
            throw new Error(`invalid status history for sprint task: ${row.id}`);
          }
          tx.update(sprintTask).set({
            status: state.status,
            completedAt: state.status === 'completed' ? recordedAt : row.completedAt,
            statusHistory: [...row.statusHistory, {
              at: recordedAt,
              status: state.status,
              sourceStatus: state.sourceStatus,
            }],
          }).where(eq(sprintTask.id, row.id)).run();
        }
        tx.update(sprint).set({ updatedAt: recordedAt }).where(eq(sprint.id, sprintId)).run();
      });
    },

    async upsertCurveSnapshot(input: CurveSnapshotInput) {
      await db.insert(curveSnapshot).values(input).onConflictDoUpdate({
        target: [curveSnapshot.sprintId, curveSnapshot.date],
        set: {
          gompertzParams: input.gompertzParams,
          inflowLambda: input.inflowLambda,
          burndownActual: input.burndownActual,
          burndownPlanned: input.burndownPlanned,
          createdAt: input.createdAt,
        },
      });
    },

    async listCurveSnapshots(sprintId: string) {
      return db.select().from(curveSnapshot)
        .where(eq(curveSnapshot.sprintId, sprintId))
        .orderBy(asc(curveSnapshot.date));
    },
  };
}
