// docs/design/projecthub-pm.md H4: 学生 PJ 向け週次進捗レポートを Nuntius `calliope.projecthub.weekly`
// topic へ配信する。 中身は GET /api/projecthub/progress (src/sprint/progress-engine.ts) と同じ
// on-demand 合成結果を再利用する (二重実装しない)。 Nuntius 未設定時は daily briefing /
// weekly retrospective と同じ流儀で skip + 警告を返す (無言フォールバック禁止)。

import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { ProjectHubProgressPrerequisiteError, makeProjectHubProgressEngine } from '../sprint/progress-engine.ts';

export function makeProjectHubWeeklyEngine(deps: {
  clients: CalliopeClients;
  repo: CalliopeRepository;
  now?: () => Date;
}) {
  const progress = makeProjectHubProgressEngine(deps);
  return {
    getWeekly: () => progress.getProgress(),
    async sendWeekly() {
      let report: Awaited<ReturnType<typeof progress.getProgress>>;
      try {
        report = await progress.getProgress();
      } catch (error) {
        if (error instanceof ProjectHubProgressPrerequisiteError) {
          return {
            report: null,
            notification: {
              status: 'skipped' as const,
              warning: `projecthub_prerequisites_missing: ${error.missing.join(', ')}`,
            },
          };
        }
        throw error;
      }
      if (!deps.clients.nuntius) {
        return {
          report,
          notification: { status: 'skipped' as const, warning: 'nuntius_unconfigured_or_token_missing' },
        };
      }
      const published = await deps.clients.nuntius.publishProjectHubWeeklyReport(report);
      return {
        report,
        notification: { status: 'sent' as const, topic: published.topic, delivered: published.delivered },
      };
    },
  };
}
