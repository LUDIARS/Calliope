import { and, desc, eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { goalRiskSnapshot } from '../schema.ts';

export type GoalRiskLevel = 'green' | 'amber' | 'red';

export interface GoalRiskSnapshotInput {
  id: string;
  goalRef: string;
  date: string;
  projectedCompletion: string;
  deadline: string;
  level: GoalRiskLevel;
  factors: unknown;
  createdAt: string;
}

export function makeRiskRepository(db: CalliopeDb) {
  return {
    async upsertGoalRiskSnapshot(input: GoalRiskSnapshotInput) {
      await db.insert(goalRiskSnapshot).values(input).onConflictDoUpdate({
        target: [goalRiskSnapshot.goalRef, goalRiskSnapshot.date],
        set: {
          projectedCompletion: input.projectedCompletion,
          deadline: input.deadline,
          level: input.level,
          factors: input.factors,
          createdAt: input.createdAt,
        },
      });
      const rows = await db.select().from(goalRiskSnapshot).where(and(
        eq(goalRiskSnapshot.goalRef, input.goalRef),
        eq(goalRiskSnapshot.date, input.date),
      )).limit(1);
      const stored = rows[0];
      if (!stored) throw new Error(`goal risk upsert failed: ${input.goalRef}/${input.date}`);
      return stored;
    },

    async getLatestGoalRisk(goalRef: string) {
      const rows = await db.select().from(goalRiskSnapshot)
        .where(eq(goalRiskSnapshot.goalRef, goalRef))
        .orderBy(desc(goalRiskSnapshot.date))
        .limit(1);
      return rows[0] ?? null;
    },

    async listGoalRisks(filter: { goalRef?: string; level?: GoalRiskLevel } = {}) {
      const rows = await db.select().from(goalRiskSnapshot).orderBy(desc(goalRiskSnapshot.date));
      return rows.filter((row) =>
        (filter.goalRef === undefined || row.goalRef === filter.goalRef) &&
        (filter.level === undefined || row.level === filter.level));
    },

    async getGoalRiskOnDate(goalRef: string, date: string) {
      const rows = await db.select().from(goalRiskSnapshot).where(and(
        eq(goalRiskSnapshot.goalRef, goalRef),
        eq(goalRiskSnapshot.date, date),
      )).limit(1);
      return rows[0] ?? null;
    },
  };
}
