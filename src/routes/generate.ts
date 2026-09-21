import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeRetrospectiveEngine } from '../retrospective/engine.ts';
import { makeTaskGenerationService } from '../taskgen/service.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

/**
 * タスク自動生成の on-demand 受口。 候補検出そのものは taskgen に閉じ、
 * ここは上流未設定 503 / 上流失敗 502 の写像だけを持つ。
 *
 * @spec POST /api/tasks/generate
 * @spec エラー写像
 */

export interface GenerateRoutesDeps {
  config: CalliopeConfig;
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

/**
 * docs/design/task-lifecycle.md §G2: 候補一覧は既存 `GET /api/confirmations?status=pending`
 * に載るため read API は増やさない。 ここは on-demand 再生成の POST のみ。
 */
export function mountGenerateRoutes(app: Hono, deps: GenerateRoutesDeps) {
  app.post('/api/tasks/generate', async (c) => {
    if (!deps.clients.actio) throw unconfigured('actio');
    const service = makeTaskGenerationService({
      config: deps.config,
      actio: deps.clients.actio,
      repo: deps.repo,
      retrospective: makeRetrospectiveEngine({ clients: deps.clients, repo: deps.repo }),
    });
    try {
      return c.json(await service.generate());
    } catch (error) {
      return upstreamFailure(error);
    }
  });
}
