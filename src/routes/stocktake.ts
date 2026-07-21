import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeStocktakeService } from '../stocktake/service.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

export interface StocktakeRoutesDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

export function mountStocktakeRoutes(app: Hono, deps: StocktakeRoutesDeps) {
  function service() {
    if (!deps.clients.actio) throw unconfigured('actio');
    if (!deps.clients.memoria) throw unconfigured('memoria');
    return makeStocktakeService({
      config: deps.config,
      actio: deps.clients.actio,
      memoria: deps.clients.memoria,
      repo: deps.repo,
    });
  }

  // GET: 最新レポートをオンデマンド合成して返す (保存しない — briefing と同じ方針)。
  app.get('/api/tasks/stocktake', async (c) => {
    try {
      return c.json(await service().getReport());
    } catch (error) {
      return upstreamFailure(error);
    }
  });

  // POST: 再実行。 整理提案があれば task_stocktake confirmation を積む。
  app.post('/api/tasks/stocktake', async (c) => {
    try {
      return c.json(await service().runStocktake());
    } catch (error) {
      return upstreamFailure(error);
    }
  });
}
