import { and, eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { plan, planEntry, rescheduleLog } from '../schema.ts';

export interface NewPlan {
  id: string;
  goalRef?: string | null;
  periodStart: string;
  periodEnd: string;
  status?: 'draft' | 'active' | 'superseded';
  velocitySnapshot: unknown;
  createdAt: string;
  supersededBy?: string | null;
}

export interface NewPlanEntry {
  id: string;
  planId: string;
  taskRef: string;
  startAt: string | null;
  endAt: string | null;
  lane: string;
  seq: number;
  schedulaEventId?: string | null;
  confidence: number;
  isHumanGate: boolean;
}

export interface RescheduleLogInput {
  id: string;
  trigger: string;
  before: unknown;
  after: unknown;
  appliedBy: 'human' | 'auto';
  reason: string;
  createdAt: string;
  outcome?: 'proposed' | 'applied' | 'rejected' | 'expired';
  confirmationId?: string | null;
}

export function makePlanRepository(db: CalliopeDb) {
  return {
    async createPlan(input: NewPlan) {
      await db.insert(plan).values({
        ...input,
        goalRef: input.goalRef ?? null,
        status: input.status ?? 'draft',
        supersededBy: input.supersededBy ?? null,
      });
    },

    async createPlanWithEntries(input: NewPlan, entries: NewPlanEntry[]) {
      db.transaction((tx) => {
        tx.insert(plan).values({
          ...input,
          goalRef: input.goalRef ?? null,
          status: input.status ?? 'draft',
          supersededBy: input.supersededBy ?? null,
        }).run();
        if (entries.length > 0) tx.insert(planEntry).values(entries).run();
      });
    },

    async listPlans(status?: 'draft' | 'active' | 'superseded') {
      if (!status) return db.select().from(plan);
      return db.select().from(plan).where(eq(plan.status, status));
    },

    async getPlan(id: string) {
      const rows = await db.select().from(plan).where(eq(plan.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async getPlanEntries(planId: string) {
      return db.select().from(planEntry).where(eq(planEntry.planId, planId));
    },

    async getPlanWithEntries(id: string) {
      const rows = await db.select().from(plan).where(eq(plan.id, id)).limit(1);
      const found = rows[0];
      if (!found) return null;
      return { ...found, entries: await db.select().from(planEntry).where(eq(planEntry.planId, id)) };
    },

    async createRescheduleLog(input: RescheduleLogInput) {
      await db.insert(rescheduleLog).values({
        ...input,
        outcome: input.outcome ?? 'applied',
        confirmationId: input.confirmationId ?? null,
      });
    },

    async listRescheduleLogs() {
      return db.select().from(rescheduleLog);
    },

    async applyPlan(id: string, log: Omit<RescheduleLogInput, 'before' | 'after'>) {
      return db.transaction((tx) => {
        const target = tx.select().from(plan).where(eq(plan.id, id)).get();
        if (!target) throw new Error(`plan not found: ${id}`);
        if (target.status !== 'draft') throw new Error(`plan is not draft: ${id}`);

        const activePlans = tx.select().from(plan).where(eq(plan.status, 'active')).all();
        tx.update(plan).set({ status: 'superseded', supersededBy: id })
          .where(and(eq(plan.status, 'active'))).run();
        tx.update(plan).set({ status: 'active', supersededBy: null }).where(eq(plan.id, id)).run();

        const active = { ...target, status: 'active' as const, supersededBy: null };
        tx.insert(rescheduleLog).values({
          ...log,
          before: activePlans,
          after: active,
          outcome: log.outcome ?? 'applied',
          confirmationId: log.confirmationId ?? null,
        }).run();
        return { plan: active, superseded: activePlans.map((item) => item.id) };
      });
    },
  };
}
