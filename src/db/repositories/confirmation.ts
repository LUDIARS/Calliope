import { and, eq, lt } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { confirmation, rescheduleLog } from '../schema.ts';

export type ConfirmationKind =
  | 'plan_apply'
  | 'reschedule'
  | 'calendar_write'
  | 'task_stocktake'
  /** docs/design/task-lifecycle.md §G2: タスク自動生成の起票提案。 */
  | 'task_create';
export type ConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ConfirmationInput {
  id: string;
  kind: ConfirmationKind;
  payload: unknown;
  createdAt: string;
  expiresAt: string;
}

export function makeConfirmationRepository(db: CalliopeDb) {
  return {
    async createConfirmation(input: ConfirmationInput) {
      await db.insert(confirmation).values({ ...input, status: 'pending' });
    },

    async getConfirmation(id: string) {
      const rows = await db.select().from(confirmation).where(eq(confirmation.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listConfirmations(status?: ConfirmationStatus) {
      if (!status) return db.select().from(confirmation);
      return db.select().from(confirmation).where(eq(confirmation.status, status));
    },

    async expirePendingConfirmations(now: string) {
      const expired = await db.select().from(confirmation).where(and(
        eq(confirmation.status, 'pending'),
        lt(confirmation.expiresAt, now),
      ));
      if (expired.length === 0) return [];
      db.transaction((tx) => {
        for (const row of expired) {
          tx.update(confirmation).set({ status: 'expired', decidedAt: now, decidedBy: 'system' })
            .where(eq(confirmation.id, row.id)).run();
          tx.update(rescheduleLog).set({ outcome: 'expired' })
            .where(eq(rescheduleLog.confirmationId, row.id)).run();
        }
      });
      return expired.map((row) => row.id);
    },

    async rejectConfirmation(id: string, decidedBy: 'human', reason: string, decidedAt: string) {
      return db.transaction((tx) => {
        const row = tx.select().from(confirmation).where(eq(confirmation.id, id)).get();
        if (!row) throw new Error(`confirmation not found: ${id}`);
        if (row.status !== 'pending') throw new Error(`confirmation is not pending: ${id}`);
        tx.update(confirmation).set({
          status: 'rejected', decidedAt, decidedBy, decisionReason: reason,
        }).where(eq(confirmation.id, id)).run();
        tx.update(rescheduleLog).set({ outcome: 'rejected' })
          .where(eq(rescheduleLog.confirmationId, id)).run();
        return { ...row, status: 'rejected' as const, decidedAt, decidedBy, decisionReason: reason };
      });
    },

    async approveExternalConfirmation(id: string, decidedBy: 'human', decidedAt: string, result: unknown) {
      return db.transaction((tx) => {
        const row = tx.select().from(confirmation).where(eq(confirmation.id, id)).get();
        if (!row) throw new Error(`confirmation not found: ${id}`);
        if (row.status !== 'pending') throw new Error(`confirmation is not pending: ${id}`);
        if (row.expiresAt <= decidedAt) throw new Error(`confirmation expired: ${id}`);
        const payload = row.payload && typeof row.payload === 'object'
          ? { ...row.payload, result }
          : { request: row.payload, result };
        tx.update(confirmation).set({
          status: 'approved', decidedAt, decidedBy, payload,
        }).where(eq(confirmation.id, id)).run();
        return { ...row, status: 'approved' as const, decidedAt, decidedBy, payload };
      });
    },

    async expireConfirmation(id: string, decidedAt: string, reason: string) {
      return db.transaction((tx) => {
        const row = tx.select().from(confirmation).where(eq(confirmation.id, id)).get();
        if (!row) throw new Error(`confirmation not found: ${id}`);
        if (row.status !== 'pending') return row;
        tx.update(confirmation).set({
          status: 'expired', decidedAt, decidedBy: 'system', decisionReason: reason,
        }).where(eq(confirmation.id, id)).run();
        tx.update(rescheduleLog).set({ outcome: 'expired' })
          .where(eq(rescheduleLog.confirmationId, id)).run();
        return { ...row, status: 'expired' as const, decidedAt, decidedBy: 'system', decisionReason: reason };
      });
    },
  };
}
