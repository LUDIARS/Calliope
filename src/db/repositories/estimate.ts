import { eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { taskEstimate } from '../schema.ts';

export type EstimateSource = 'human' | 'analogy' | 'llm';

export interface TaskEstimateInput {
  taskRef: string;
  effortMinutes: number;
  estimateSource: EstimateSource;
  confidence: number;
  estimatedAt: string;
}

export function makeEstimateRepository(db: CalliopeDb) {
  return {
    async upsertTaskEstimate(input: TaskEstimateInput) {
      await db.insert(taskEstimate).values(input).onConflictDoUpdate({
        target: taskEstimate.taskRef,
        set: {
          effortMinutes: input.effortMinutes,
          estimateSource: input.estimateSource,
          confidence: input.confidence,
          estimatedAt: input.estimatedAt,
        },
      });
    },

    async getTaskEstimate(taskRef: string) {
      const rows = await db.select().from(taskEstimate).where(eq(taskEstimate.taskRef, taskRef)).limit(1);
      return rows[0] ?? null;
    },

    async listTaskEstimates() {
      return db.select().from(taskEstimate);
    },
  };
}
