import { randomUUID } from 'node:crypto';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makePriorityEngine } from '../priority/engine.ts';
import { loadPlanningTasks } from '../planning/tasks.ts';
import { makeSchedulerEngine } from '../scheduler/engine.ts';
import { makeSprintEngine } from '../sprint/engine.ts';
import { makeVelocityEngine } from '../velocity/engine.ts';
import { comparePlans } from './diff.ts';
import { assessRescheduleRisk } from './risk.ts';
import { makeCalendarEngine } from '../calendar/engine.ts';

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

export type RescheduleTrigger = 'manual' | 'task_change' | 'estimate_change' | 'deadline_change' |
  'velocity_drift' | 'priority_interrupt' | 'dependency_change' | 'daily' | 'confirmation_expired';

export class ReschedulePrerequisiteError extends Error {
  constructor(public missing: string[]) {
    super(`reschedule prerequisites missing: ${missing.join(', ')}`);
    this.name = 'ReschedulePrerequisiteError';
  }
}

export interface RescheduleEngineDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
  now?: () => Date;
  id?: () => string;
}

export function makeRescheduleEngine(deps: RescheduleEngineDeps) {
  const scheduler = makeSchedulerEngine(deps);

  async function refresh(trigger: RescheduleTrigger): Promise<void> {
    const actio = deps.clients.actio;
    const memoria = deps.clients.memoria;
    if (!actio || !memoria) {
      throw new ReschedulePrerequisiteError([
        ...(!actio ? ['actio'] : []),
        ...(!memoria ? ['memoria'] : []),
      ]);
    }
    if (trigger === 'daily') {
      const activeSprints = await deps.repo.listSprints({ status: 'active' });
      const sprintEngine = makeSprintEngine({
        clients: deps.clients, repo: deps.repo, agentLanes: deps.config.agentLanes,
        now: deps.now, id: deps.id,
      });
      for (const sprint of activeSprints) await sprintEngine.replan(sprint.id);
    }
    await makeVelocityEngine({ actio, memoria, repo: deps.repo, now: deps.now }).refresh();
    await makePriorityEngine({ actio, memoria, repo: deps.repo, now: deps.now }).refresh();
  }

  return {
    async trigger(input: {
      trigger: RescheduleTrigger;
      projectRef?: string;
      horizonDays?: number;
      refresh?: boolean;
    }) {
      const now = deps.now?.() ?? new Date();
      await deps.repo.expirePendingConfirmations(now.toISOString());
      if (input.refresh ?? true) await refresh(input.trigger);
      const activePlans = await deps.repo.listPlans('active');
      const active = activePlans[0];
      if (!active) throw new ReschedulePrerequisiteError(['active_plan']);
      const pending = await deps.repo.listConfirmations('pending');
      for (const decision of pending) {
        if (decision.kind !== 'reschedule' || !decision.payload || typeof decision.payload !== 'object') continue;
        const beforePlanId = 'beforePlanId' in decision.payload
          ? (decision.payload as { beforePlanId?: unknown }).beforePlanId
          : null;
        if (beforePlanId === active.id) {
          await deps.repo.expireConfirmation(decision.id, now.toISOString(), 'superseded by newer proposal');
        }
      }
      const activeWithEntries = await deps.repo.getPlanWithEntries(active.id);
      if (!activeWithEntries) throw new ReschedulePrerequisiteError(['active_plan_entries']);
      const candidateResult = await scheduler.generate({
        horizonDays: input.horizonDays,
        persist: false,
      });
      if (!candidateResult.plan) throw new Error('scheduler returned no candidate plan');
      const candidate = candidateResult.plan;
      const diff = comparePlans(activeWithEntries, candidate);
      if (!diff.hasChanges) {
        return { outcome: 'no_change' as const, diff, risk: { level: 'low', reasons: [], requiresConfirmation: false } };
      }
      const actio = deps.clients.actio;
      if (!actio) throw new ReschedulePrerequisiteError(['actio']);
      const tasks = await loadPlanningTasks(actio);
      const risk = assessRescheduleRisk(diff, {
        now,
        tasks: tasks.map((task) => ({ taskRef: task.taskRef, projectRef: task.projectRef, dueAt: task.dueAt })),
        triggerProjectRef: input.projectRef,
      });
      const { entries, ...planRecord } = candidate;
      await deps.repo.createPlanWithEntries(planRecord, entries);
      if (!risk.requiresConfirmation) {
        const applied = await deps.repo.applyPlan(candidate.id, {
          id: (deps.id ?? randomUUID)(),
          trigger: input.trigger,
          appliedBy: 'auto',
          reason: 'P3 low-risk reschedule auto-apply',
          createdAt: now.toISOString(),
          outcome: 'applied',
        });
        const calendar = await makeCalendarEngine(deps).requestSync(applied.plan.id);
        return {
          outcome: 'applied' as const, plan: applied.plan, diff, risk,
          calendar,
          notificationStatus: 'not_sent_missing_authenticated_project_context',
        };
      }
      const confirmationId = (deps.id ?? randomUUID)();
      const payload = {
        beforePlanId: active.id,
        afterPlanId: candidate.id,
        trigger: input.trigger,
        projectRef: input.projectRef ?? null,
        diff,
        risk,
      };
      const confirmation = {
        id: confirmationId,
        kind: 'reschedule',
        payload,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString(),
      } as const;
      await deps.repo.createRescheduleProposal(confirmation, {
        id: (deps.id ?? randomUUID)(),
        trigger: input.trigger,
        before: activeWithEntries,
        after: candidate,
        appliedBy: 'auto',
        reason: `P3 high-risk proposal: ${risk.reasons.map((reason) => reason.code).join(', ')}`,
        createdAt: now.toISOString(),
        outcome: 'proposed',
        confirmationId,
      });
      return {
        outcome: 'confirmation_required' as const,
        confirmationId,
        diff,
        risk,
        notificationStatus: 'not_sent_missing_authenticated_project_context',
      };
    },
  };
}
