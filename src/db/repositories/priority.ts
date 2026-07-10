import { and, eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { priority } from '../schema.ts';

export type PriorityScope = 'project' | 'goal' | 'task';

export interface PriorityInput {
  scope: PriorityScope;
  ref: string;
  resolvedScore: number;
  breakdown: unknown;
  firstReadyAt?: string | null;
  updatedAt: string;
}

function priorityId(scope: PriorityScope, ref: string): string {
  return `${scope}:${ref}`;
}

export function makePriorityRepository(db: CalliopeDb) {
  return {
    async upsertPriority(input: PriorityInput) {
      const id = priorityId(input.scope, input.ref);
      const existing = await db.select().from(priority).where(eq(priority.id, id)).limit(1);
      const firstReadyAt = existing[0]?.firstReadyAt ?? input.firstReadyAt ?? null;
      await db.insert(priority).values({ id, ...input, firstReadyAt }).onConflictDoUpdate({
        target: priority.id,
        set: {
          resolvedScore: input.resolvedScore,
          breakdown: input.breakdown,
          firstReadyAt,
          updatedAt: input.updatedAt,
        },
      });
    },

    async getPriority(scope: PriorityScope, ref: string) {
      const rows = await db.select().from(priority).where(and(
        eq(priority.scope, scope),
        eq(priority.ref, ref),
      )).limit(1);
      return rows[0] ?? null;
    },

    async listPriorities(filter: { scope?: PriorityScope; ref?: string } = {}) {
      const rows = await db.select().from(priority);
      return rows.filter((row) =>
        (filter.scope === undefined || row.scope === filter.scope) &&
        (filter.ref === undefined || row.ref === filter.ref));
    },
  };
}
