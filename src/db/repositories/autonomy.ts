import { and, eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { confirmation, plan, rescheduleLog } from '../schema.ts';
import type { ConfirmationInput } from './confirmation.ts';
import type { RescheduleLogInput } from './plan.ts';

export interface ConfirmedPlanApplyInput {
  confirmationId: string;
  expectedActivePlanId: string;
  targetPlanId: string;
  decidedAt: string;
  decidedBy: 'human';
  logId: string;
}

export function makeAutonomyRepository(db: CalliopeDb) {
  return {
    async createRescheduleProposal(
      decision: ConfirmationInput,
      log: RescheduleLogInput,
    ) {
      db.transaction((tx) => {
        tx.insert(confirmation).values({ ...decision, status: 'pending' }).run();
        tx.insert(rescheduleLog).values({
          ...log,
          outcome: 'proposed',
          confirmationId: decision.id,
        }).run();
      });
    },

    async applyConfirmedPlan(input: ConfirmedPlanApplyInput) {
      return db.transaction((tx) => {
        const decision = tx.select().from(confirmation)
          .where(eq(confirmation.id, input.confirmationId)).get();
        if (!decision) throw new Error(`confirmation not found: ${input.confirmationId}`);
        if (decision.status !== 'pending') throw new Error(`confirmation is not pending: ${input.confirmationId}`);
        if (decision.expiresAt <= input.decidedAt) throw new Error(`confirmation expired: ${input.confirmationId}`);
        const active = tx.select().from(plan).where(eq(plan.status, 'active')).all();
        if (active.length !== 1 || active[0]?.id !== input.expectedActivePlanId) {
          throw new Error(`confirmation stale: ${input.confirmationId}`);
        }
        const target = tx.select().from(plan).where(and(
          eq(plan.id, input.targetPlanId), eq(plan.status, 'draft'),
        )).get();
        if (!target) throw new Error(`confirmation target unavailable: ${input.targetPlanId}`);
        tx.update(plan).set({ status: 'superseded', supersededBy: target.id })
          .where(eq(plan.id, input.expectedActivePlanId)).run();
        tx.update(plan).set({ status: 'active', supersededBy: null })
          .where(eq(plan.id, target.id)).run();
        tx.insert(rescheduleLog).values({
          id: input.logId,
          trigger: 'confirmation_approved',
          before: active,
          after: target,
          appliedBy: 'human',
          reason: `approved confirmation ${input.confirmationId}`,
          createdAt: input.decidedAt,
          outcome: 'applied',
          confirmationId: input.confirmationId,
        }).run();
        const payload = decision.payload && typeof decision.payload === 'object'
          ? { ...decision.payload, result: { activePlanId: target.id } }
          : { proposal: decision.payload, result: { activePlanId: target.id } };
        tx.update(confirmation).set({
          status: 'approved', decidedAt: input.decidedAt, decidedBy: input.decidedBy, payload,
        }).where(eq(confirmation.id, input.confirmationId)).run();
        tx.update(rescheduleLog).set({ outcome: 'applied' })
          .where(eq(rescheduleLog.confirmationId, input.confirmationId)).run();
        return { plan: { ...target, status: 'active' as const }, superseded: input.expectedActivePlanId };
      });
    },
  };
}
