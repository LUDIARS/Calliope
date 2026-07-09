import { Hono } from 'hono';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository, ConnectorHealth } from '../db/repository.ts';

export interface HealthRoutesDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

type ServiceName = 'actio' | 'schedula' | 'memoria';

async function checkService(name: ServiceName, deps: HealthRoutesDeps) {
  const client = deps.clients[name];
  const now = new Date().toISOString();
  let health: ConnectorHealth = 'unconfigured';

  if (client) {
    try {
      await client.health();
      health = 'ok';
    } catch {
      health = 'down';
    }
  }

  await deps.repo.upsertConnectorState({
    service: name,
    health,
    lastSyncAt: health === 'ok' ? now : null,
    updatedAt: now,
  });

  return {
    configured: Boolean(deps.config[name].baseUrl),
    health,
  };
}

export function mountHealthRoutes(app: Hono, deps: HealthRoutesDeps) {
  app.get('/health', async (c) => {
    const [actio, schedula, memoria] = await Promise.all([
      checkService('actio', deps),
      checkService('schedula', deps),
      checkService('memoria', deps),
    ]);

    return c.json({
      ok: true,
      service: 'calliope',
      port: deps.config.port,
      upstreams: { actio, schedula, memoria },
      connectorState: await deps.repo.listConnectorStates(),
    });
  });
}
