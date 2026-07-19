// docs/design/<private-reference-004>-pm.md H4: 学生 PJ 向け週次進捗レポートを Nuntius `calliope.<private-reference-004>.weekly`
// topic へ配信する。 中身は GET /api/<private-reference-004>/progress (src/sprint/progress-engine.ts) と同じ
// on-demand 合成結果を再利用する (二重実装しない)。 Nuntius 未設定時は daily briefing /
// weekly retrospective と同じ流儀で skip + 警告を返す (無言フォールバック禁止)。

import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { <private-reference-004>ProgressPrerequisiteError, make<private-reference-004>ProgressEngine } from '../sprint/progress-engine.ts';

export function make<private-reference-004>WeeklyEngine(deps: {
  clients: CalliopeClients;
  repo: CalliopeRepository;
  now?: () => Date;
}) {
  const progress = make<private-reference-004>ProgressEngine(deps);
  return {
    getWeekly: () => progress.getProgress(),
    async sendWeekly() {
      let report: Awaited<ReturnType<typeof progress.getProgress>>;
      try {
        report = await progress.getProgress();
      } catch (error) {
        if (error instanceof <private-reference-004>ProgressPrerequisiteError) {
          return {
            report: null,
            notification: {
              status: 'skipped' as const,
              warning: `<private-reference-004>_prerequisites_missing: ${error.missing.join(', ')}`,
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
      const published = await deps.clients.nuntius.publish<private-reference-004>WeeklyReport(report);
      return {
        report,
        notification: { status: 'sent' as const, topic: published.topic, delivered: published.delivered },
      };
    },
  };
}
