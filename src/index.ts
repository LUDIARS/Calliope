import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { makeClients } from './clients/index.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/client.ts';
import { makeRepository } from './db/repository.ts';
import { startDailyOrchestrator } from './orchestration/daily.ts';
import { makeRescheduleEngine } from './reschedule/engine.ts';
import { makeBriefingEngine } from './briefing/engine.ts';
import { makeDailyLoop } from './orchestration/loop.ts';
import { startWeeklyOrchestrator } from './orchestration/weekly.ts';
import { makeRetrospectiveEngine } from './retrospective/engine.ts';
import { make<private-reference-004>WeeklyEngine } from './retrospective/<private-reference-004>-weekly.ts';

const config = loadConfig();
if (!config.serviceToken) {
  console.warn('[calliope] CALLIOPE_SERVICE_TOKEN is unset; /api routes are unauthenticated');
}
const db = openDb(config.dbPath);
const clients = makeClients(config);
const repo = makeRepository(db);
const app = createApp(config, { db, clients });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[calliope] listening on http://localhost:${info.port}`);
  console.log(`[calliope] upstreams: actio=${config.actio.baseUrl ?? '(unset)'} ` +
    `schedula=${config.schedula.baseUrl ?? '(unset)'} memoria=${config.memoria.baseUrl ?? '(unset)'}`);
});

const daily = config.dailyOrchestration !== false
  ? startDailyOrchestrator(
    makeDailyLoop({
      reschedule: () => makeRescheduleEngine({ config, clients, repo }).trigger({ trigger: 'daily' }),
      briefing: () => makeBriefingEngine({ clients, repo }).sendToday(),
    }),
    {
      onError: (error) => process.stderr.write(
        `[calliope] daily orchestration failed: ${error instanceof Error ? error.name : 'unknown'}\n`,
      ),
    },
  )
  : null;

const weekly = config.weeklyRetrospective !== false
  ? startWeeklyOrchestrator(
    () => makeRetrospectiveEngine({ clients, repo }).sendWeekly(),
    { onError: (error) => process.stderr.write(
      `[calliope] weekly retrospective failed: ${error instanceof Error ? error.name : 'unknown'}\n`,
    ) },
  )
  : null;

const <private-reference-004>Weekly = config.<private-reference-004>WeeklyReport !== false
  ? startWeeklyOrchestrator(
    () => make<private-reference-004>WeeklyEngine({ clients, repo }).sendWeekly(),
    { onError: (error) => process.stderr.write(
      `[calliope] <private-reference-004> weekly report failed: ${error instanceof Error ? error.name : 'unknown'}\n`,
    ) },
  )
  : null;

function shutdown(): void {
  daily?.stop();
  weekly?.stop();
  <private-reference-004>Weekly?.stop();
  server.close(() => {
    db.$client.close();
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
