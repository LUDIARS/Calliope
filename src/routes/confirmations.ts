import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository, ConfirmationStatus } from '../db/repository.ts';
import { makeRescheduleEngine } from '../reschedule/engine.ts';
import { CalendarPrerequisiteError, makeCalendarEngine } from '../calendar/engine.ts';
import { applyStocktakeProposals } from '../stocktake/apply.ts';
import { stocktakeConfirmationPayloadSchema } from '../stocktake/payload.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(1).optional(),
  decidedBy: z.string().trim().min(1).default('human'),
}).superRefine((value, ctx) => {
  if (value.decision === 'reject' && !value.reason) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is required for rejection' });
  }
});

const reschedulePayloadSchema = z.object({
  beforePlanId: z.string().min(1),
  afterPlanId: z.string().min(1),
});
const calendarPayloadSchema = z.object({ planId: z.string().min(1) });

export interface ConfirmationRoutesDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

export function mountConfirmationRoutes(app: Hono, deps: ConfirmationRoutesDeps) {
  const reschedule = makeRescheduleEngine(deps);
  const calendar = makeCalendarEngine(deps);

  app.get('/api/confirmations', async (c) => {
    const status = c.req.query('status');
    if (status && !['pending', 'approved', 'rejected', 'expired'].includes(status)) {
      return c.json({ error: 'invalid_status' }, 400);
    }
    await deps.repo.expirePendingConfirmations(new Date().toISOString());
    return c.json({ confirmations: await deps.repo.listConfirmations(status as ConfirmationStatus | undefined) });
  });

  app.post('/api/confirmations/:id', async (c) => {
    const parsed = decisionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    const id = c.req.param('id');
    const row = await deps.repo.getConfirmation(id);
    if (!row) return c.json({ error: 'confirmation_not_found' }, 404);
    if (row.status !== 'pending') return c.json({ error: 'confirmation_not_pending', status: row.status }, 409);
    const now = new Date();
    if (row.expiresAt <= now.toISOString()) {
      await deps.repo.expireConfirmation(id, now.toISOString(), '24h expiry');
      if (row.kind === 'calendar_write' || row.kind === 'task_stocktake') {
        return c.json({ error: 'confirmation_expired' }, 409);
      }
      const reproposal = await reschedule.trigger({ trigger: 'confirmation_expired', refresh: false });
      return c.json({ error: 'confirmation_expired', reproposal }, 409);
    }
    if (parsed.data.decision === 'reject') {
      return c.json({ confirmation: await deps.repo.rejectConfirmation(
        id, parsed.data.decidedBy, parsed.data.reason ?? '', now.toISOString(),
      ) });
    }
    if (row.kind === 'task_stocktake') {
      const payload = stocktakeConfirmationPayloadSchema.safeParse(row.payload);
      if (!payload.success) return c.json({ error: 'invalid_confirmation_payload' }, 500);
      if (!deps.clients.actio) throw unconfigured('actio');
      try {
        const result = await applyStocktakeProposals(deps.clients.actio, payload.data.proposals);
        const confirmation = await deps.repo.approveExternalConfirmation(
          id, parsed.data.decidedBy, now.toISOString(), result,
        );
        return c.json({ confirmation, result });
      } catch (error) {
        return upstreamFailure(error);
      }
    }
    if (row.kind === 'calendar_write') {
      const payload = calendarPayloadSchema.safeParse(row.payload);
      if (!payload.success) return c.json({ error: 'invalid_confirmation_payload' }, 500);
      try {
        const result = await calendar.syncPlan(payload.data.planId);
        const confirmation = await deps.repo.approveExternalConfirmation(
          id, parsed.data.decidedBy, now.toISOString(), result,
        );
        return c.json({ confirmation, result });
      } catch (error) {
        if (error instanceof CalendarPrerequisiteError) {
          return c.json({ error: 'calendar_prerequisites_missing', missing: error.missing }, 400);
        }
        const message = error instanceof Error ? error.message : '';
        if (message.startsWith('plan not found:')) return c.json({ error: 'plan_not_found' }, 404);
        if (message.startsWith('plan is not active:')) return c.json({ error: 'plan_not_active' }, 409);
        return upstreamFailure(error);
      }
    }
    if (row.kind !== 'reschedule' && row.kind !== 'plan_apply') {
      return c.json({ error: 'unsupported_confirmation_kind', kind: row.kind }, 409);
    }
    const payload = reschedulePayloadSchema.safeParse(row.payload);
    if (!payload.success) return c.json({ error: 'invalid_confirmation_payload' }, 500);
    try {
      const result = await deps.repo.applyConfirmedPlan({
        confirmationId: id,
        expectedActivePlanId: payload.data.beforePlanId,
        targetPlanId: payload.data.afterPlanId,
        decidedAt: now.toISOString(),
        decidedBy: parsed.data.decidedBy,
        logId: randomUUID(),
      });
      return c.json({
        confirmation: await deps.repo.getConfirmation(id),
        result,
        calendar: await calendar.requestSync(result.plan.id),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('confirmation stale:') || message.startsWith('confirmation target unavailable:') ||
        message.startsWith('confirmation expired:')) {
        await deps.repo.expireConfirmation(id, now.toISOString(), 'stale plan state');
        const reproposal = await reschedule.trigger({ trigger: 'confirmation_expired', refresh: false });
        return c.json({ error: 'confirmation_stale', reproposal }, 409);
      }
      throw error;
    }
  });
}
