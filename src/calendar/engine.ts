import { randomUUID } from 'node:crypto';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

export class CalendarPrerequisiteError extends Error {
  constructor(public missing: string[]) {
    super(`calendar prerequisites missing: ${missing.join(', ')}`);
    this.name = 'CalendarPrerequisiteError';
  }
}

export function makeCalendarEngine(deps: {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
  now?: () => Date;
  id?: () => string;
}) {
  async function syncPlan(planId: string) {
    const schedula = deps.clients.schedula;
    if (!schedula) throw new CalendarPrerequisiteError(['schedula']);
    const links = await deps.repo.listCalendarLinks();
    const link = links.find((item) => item.enabled && ['write', 'both'].includes(item.syncDirection));
    if (!link) throw new CalendarPrerequisiteError(['calendar_link']);
    const target = await deps.repo.getPlanWithEntries(planId);
    if (!target) throw new Error(`plan not found: ${planId}`);
    if (target.status !== 'active') throw new Error(`plan is not active: ${planId}`);
    const superseded = (await deps.repo.listPlans('superseded'))
      .filter((plan) => plan.supersededBy === target.id);
    const oldEntries = (await Promise.all(superseded.map((plan) => deps.repo.getPlanEntries(plan.id)))).flat();
    const reusable = new Map(oldEntries
      .filter((entry) => entry.schedulaEventId)
      .map((entry) => [entry.taskRef, entry]));
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let skipped = 0;
    for (const entry of target.entries) {
      if (!entry.startAt || !entry.endAt) {
        skipped++;
        continue;
      }
      const payload = {
        summary: `Calliope: ${entry.taskRef}`,
        description: 'Calliope plan block',
        start: { dateTime: entry.startAt },
        end: { dateTime: entry.endAt },
        extendedProperties: { private: {
          calliope: entry.id,
          calliopePlan: target.id,
        } },
      };
      const previous = reusable.get(entry.taskRef);
      if (entry.schedulaEventId) {
        await schedula.patchCalendarEvent(entry.schedulaEventId, payload);
        if (previous?.schedulaEventId === entry.schedulaEventId) {
          await deps.repo.setPlanEntrySchedulaEvent(previous.id, null);
          reusable.delete(entry.taskRef);
        }
        updated++;
      } else if (previous?.schedulaEventId) {
        await schedula.patchCalendarEvent(previous.schedulaEventId, payload);
        await deps.repo.setPlanEntrySchedulaEvent(entry.id, previous.schedulaEventId);
        await deps.repo.setPlanEntrySchedulaEvent(previous.id, null);
        reusable.delete(entry.taskRef);
        updated++;
      } else {
        const event = await schedula.createCalendarEvent(payload);
        await deps.repo.setPlanEntrySchedulaEvent(entry.id, event.id);
        created++;
      }
    }
    for (const entry of oldEntries) {
      if (!entry.schedulaEventId || reusable.get(entry.taskRef)?.id !== entry.id) continue;
      await schedula.deleteCalendarEvent(entry.schedulaEventId);
      await deps.repo.setPlanEntrySchedulaEvent(entry.id, null);
      deleted++;
    }
    const syncedAt = (deps.now?.() ?? new Date()).toISOString();
    await deps.repo.upsertConnectorState({
      service: 'schedula-calendar',
      health: 'ok',
      lastSyncAt: syncedAt,
      cursor: target.id,
      updatedAt: syncedAt,
    });
    return { planId: target.id, calendarRef: link.calendarRef, created, updated, deleted, skipped };
  }

  async function requestSync(planId: string) {
    const links = await deps.repo.listCalendarLinks();
    if (!links.some((item) => item.enabled && ['write', 'both'].includes(item.syncDirection))) {
      return { status: 'skipped' as const, warning: 'calendar_link_unconfigured' };
    }
    if (!deps.clients.schedula) {
      return { status: 'skipped' as const, warning: 'schedula_unconfigured' };
    }
    if (deps.config.calendarAutoWrite === true) {
      try {
        return { status: 'applied' as const, result: await syncPlan(planId) };
      } catch (error) {
        return {
          status: 'failed' as const,
          warning: `calendar_sync_failed:${error instanceof Error ? error.name : 'unknown'}`,
        };
      }
    }
    const pending = await deps.repo.listConfirmations('pending');
    const existing = pending.find((row) => row.kind === 'calendar_write' && row.payload &&
      typeof row.payload === 'object' && 'planId' in row.payload && row.payload.planId === planId);
    if (existing) return { status: 'confirmation_required' as const, confirmationId: existing.id };
    const now = deps.now?.() ?? new Date();
    const confirmationId = (deps.id ?? randomUUID)();
    await deps.repo.createConfirmation({
      id: confirmationId,
      kind: 'calendar_write',
      payload: { planId },
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString(),
    });
    return { status: 'confirmation_required' as const, confirmationId };
  }

  return { requestSync, syncPlan };
}
