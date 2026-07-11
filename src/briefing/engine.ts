import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { composeDailyBriefing } from './compose.ts';

export function makeBriefingEngine(deps: {
  clients: CalliopeClients;
  repo: CalliopeRepository;
  now?: () => Date;
}) {
  async function getToday() {
    const now = deps.now?.() ?? new Date();
    const activePlans = await deps.repo.listPlans('active');
    const activePlan = activePlans[0] ?? null;
    const planWithEntries = activePlan ? await deps.repo.getPlanWithEntries(activePlan.id) : null;
    const sprints = await deps.repo.listSprints({ status: 'active' });
    const sprintInputs = await Promise.all(sprints.map(async (sprint) => {
      const curves = await deps.repo.listCurveSnapshots(sprint.id);
      return { ...sprint, latestCurve: curves.at(-1) ?? null };
    }));
    const pending = await deps.repo.listConfirmations('pending');
    const risks = await deps.repo.listGoalRisks();
    const latestByGoal = new Map<string, (typeof risks)[number]>();
    for (const risk of risks) {
      if (!latestByGoal.has(risk.goalRef)) latestByGoal.set(risk.goalRef, risk);
    }
    return composeDailyBriefing({
      now,
      plan: planWithEntries,
      sprints: sprintInputs,
      confirmations: pending,
      risks: [...latestByGoal.values()],
    });
  }

  return {
    getToday,
    async sendToday() {
      const briefing = await getToday();
      if (!deps.clients.nuntius) {
        return { briefing, notification: {
          status: 'skipped' as const,
          warning: 'nuntius_unconfigured_or_token_missing',
        } };
      }
      const published = await deps.clients.nuntius.publishDailyBriefing(briefing);
      return { briefing, notification: {
        status: 'sent' as const,
        topic: published.topic,
        delivered: published.delivered,
      } };
    },
  };
}
