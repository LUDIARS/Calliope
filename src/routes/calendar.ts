import { Hono } from 'hono';
import { z } from 'zod';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeCalendarEngine } from '../calendar/engine.ts';
import { upstreamFailure } from './errors.ts';

const linkSchema = z.object({
  calendarRef: z.string().trim().min(1).max(128)
    .regex(/^[^\s@]+$/, 'calendarRef must be primary or an opaque Schedula reference')
    .default('primary'),
  syncDirection: z.enum(['read', 'write', 'both']).default('both'),
  enabled: z.boolean().default(true),
});
const syncSchema = z.object({ planId: z.string().min(1).optional() });

export function mountCalendarRoutes(app: Hono, deps: {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}) {
  const engine = makeCalendarEngine(deps);

  app.get('/api/calendar/link', async (c) => c.json({ links: await deps.repo.listCalendarLinks() }));
  app.put('/api/calendar/link', async (c) => {
    const parsed = linkSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    return c.json({ link: await deps.repo.upsertCalendarLink({
      id: 'primary', ...parsed.data, updatedAt: new Date().toISOString(),
    }) });
  });

  app.post('/api/calendar/sync', async (c) => {
    const parsed = syncSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    const planId = parsed.data.planId ?? (await deps.repo.listPlans('active'))[0]?.id;
    if (!planId) return c.json({ error: 'active_plan_not_found' }, 404);
    const result = await engine.requestSync(planId);
    return c.json(result, result.status === 'confirmation_required' ? 409 : 200);
  });

  app.post('/api/calendar/pull', async (c) => {
    if (!deps.clients.schedula) return c.json({ error: 'schedula_unconfigured' }, 503);
    try {
      const result = await deps.clients.schedula.pullCalendar();
      const syncedAt = new Date().toISOString();
      await deps.repo.upsertConnectorState({
        service: 'schedula-calendar', health: 'ok', lastSyncAt: syncedAt, cursor: null, updatedAt: syncedAt,
      });
      return c.json(result);
    } catch (error) {
      return upstreamFailure(error);
    }
  });
}
