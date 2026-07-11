import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { composeWeeklyRetrospective } from './compose.ts';

export function makeRetrospectiveEngine(deps: {
  clients: CalliopeClients;
  repo: CalliopeRepository;
  now?: () => Date;
}) {
  async function getWeekly() {
    const sprints = await deps.repo.listSprints();
    const curves = (await Promise.all(sprints.map((sprint) => deps.repo.listCurveSnapshots(sprint.id)))).flat();
    return composeWeeklyRetrospective({
      now: deps.now?.() ?? new Date(),
      velocities: await deps.repo.listVelocity(),
      curves,
      priorities: await deps.repo.listPriorities(),
      logs: await deps.repo.listRescheduleLogs(),
    });
  }
  return {
    getWeekly,
    async sendWeekly() {
      const retrospective = await getWeekly();
      if (!deps.clients.nuntius) return {
        retrospective,
        notification: { status: 'skipped' as const, warning: 'nuntius_unconfigured_or_token_missing' },
      };
      const published = await deps.clients.nuntius.publishWeeklyRetrospective(retrospective);
      return {
        retrospective,
        notification: { status: 'sent' as const, topic: published.topic, delivered: published.delivered },
      };
    },
  };
}
