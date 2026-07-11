import { z } from 'zod';
import type { DailyBriefing } from '../briefing/compose.ts';
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
  return {
    async publishDailyBriefing(briefing: DailyBriefing) {
      const response = await http.post<unknown>('/api/topics/calliope.daily/publish', {
        payload: { kind: 'daily_briefing', briefing },
        source: 'calliope.daily',
      });
      return publishResponseSchema.parse(response);
    },
  };
}
