import { z } from 'zod';
import type { DailyBriefing } from '../briefing/compose.ts';
import type { WeeklyRetrospective } from '../retrospective/compose.ts';
import type { <private-reference-004>ProjectProgress } from '../sprint/progress.ts';
import { makeHttp } from './http.ts';

const publishResponseSchema = z.object({
  topic: z.string(),
  delivered: z.number().int().nonnegative(),
  messages: z.array(z.object({
    id: z.string(),
    userId: z.string(),
    channel: z.string(),
  })),
});

export function makeNuntiusClient(options: { baseUrl: string; token: string }) {
  const http = makeHttp({ ...options, service: 'nuntius' });
  async function publish(topic: string, kind: string, field: string, value: unknown) {
    const response = await http.post<unknown>(`/api/topics/${topic}/publish`, {
      payload: { kind, [field]: value },
      source: topic,
    });
    return publishResponseSchema.parse(response);
  }
  return {
    publishDailyBriefing: (briefing: DailyBriefing) => publish('calliope.daily', 'daily_briefing', 'briefing', briefing),
    publishWeeklyRetrospective: (retrospective: WeeklyRetrospective) =>
      publish('calliope.weekly', 'weekly_retrospective', 'retrospective', retrospective),
    // docs/design/<private-reference-004>-pm.md H4: <private-reference-004> (学生 PJ) 向け週次進捗レポート配信。
    publish<private-reference-004>WeeklyReport: (report: { generatedAt: string; projects: <private-reference-004>ProjectProgress[] }) =>
      publish('calliope.<private-reference-004>.weekly', '<private-reference-004>_weekly_report', 'report', report),
  };
}
