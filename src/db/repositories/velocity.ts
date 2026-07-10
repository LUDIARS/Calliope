import { and, desc, eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { velocity } from '../schema.ts';

export interface NewVelocity {
  id: string;
  projectRef: string;
  category: string;
  windowStart: string;
  windowEnd: string;
  kFactor: number;
  throughput: number;
  distribution: unknown;
  sampleSize: number;
  source: string;
}

export interface VelocityFilter {
  projectRef?: string;
  category?: string;
}

export function makeVelocityRepository(db: CalliopeDb) {
  return {
    async replaceVelocityRows(rows: NewVelocity[]) {
      db.transaction((tx) => {
        for (const row of rows) {
          tx.delete(velocity).where(and(
            eq(velocity.projectRef, row.projectRef),
            eq(velocity.category, row.category),
            eq(velocity.windowStart, row.windowStart),
            eq(velocity.windowEnd, row.windowEnd),
          )).run();
          tx.insert(velocity).values(row).run();
        }
      });
    },

    async createVelocity(input: NewVelocity) {
      await db.insert(velocity).values(input);
    },

    async listVelocity(filter: VelocityFilter = {}) {
      const rows = await db.select().from(velocity).orderBy(desc(velocity.windowEnd));
      return rows.filter((row) =>
        (filter.projectRef === undefined || row.projectRef === filter.projectRef) &&
        (filter.category === undefined || row.category === filter.category));
    },

    async listLatestVelocity(filter: VelocityFilter = {}) {
      const allRows = await db.select().from(velocity).orderBy(desc(velocity.windowEnd));
      const rows = allRows.filter((row) =>
        (filter.projectRef === undefined || row.projectRef === filter.projectRef) &&
        (filter.category === undefined || row.category === filter.category));
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const key = `${row.projectRef}\u0000${row.category}`;
        if (!latest.has(key)) latest.set(key, row);
      }
      return [...latest.values()];
    },
  };
}
