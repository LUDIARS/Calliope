import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { ProjectHubProgressPrerequisiteError, makeProjectHubProgressEngine } from '../sprint/progress-engine.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

export interface ProjectHubRoutesDeps {
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

/**
 * docs/design/projecthub-pm.md H4/H5: Calliope 側の学生 PJ 進捗 API。
 * PROJECTHUB progress パネル (H5、PROJECTHUB 側) がこの API を read する想定 (Aedilis の
 * HttpServiceConnector と同じ接続パターン)。 Calliope 自身は Corpus 配下ではないため
 * (id532 実装時判明の /api/x/<module> 制約は PROJECTHUB 側プラグインの話で、 Calliope の
 * 自前ルートには適用されない)、 設計文書どおり `/api/projecthub/progress` を素のパスで公開する。
 */
export function mountProjectHubRoutes(app: Hono, deps: ProjectHubRoutesDeps) {
  const engine = makeProjectHubProgressEngine(deps);

  app.get('/api/projecthub/progress', async (c) => {
    try {
      return c.json(await engine.getProgress({ projectId: c.req.query('project_id') }));
    } catch (error) {
      if (error instanceof ProjectHubProgressPrerequisiteError) {
        if (error.missing.length === 1) throw unconfigured(error.missing[0] as string);
        return c.json({ error: 'projecthub_progress_prerequisites_missing', missing: error.missing }, 400);
      }
      return upstreamFailure(error);
    }
  });
}
