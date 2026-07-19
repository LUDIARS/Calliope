import { Hono } from 'hono';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { <private-reference-004>ProgressPrerequisiteError, make<private-reference-004>ProgressEngine } from '../sprint/progress-engine.ts';
import { unconfigured, upstreamFailure } from './errors.ts';

export interface <private-reference-004>RoutesDeps {
  clients: CalliopeClients;
  repo: CalliopeRepository;
}

/**
 * docs/design/<private-reference-004>-pm.md H4/H5: Calliope 側の学生 PJ 進捗 API。
 * <private-reference-004> progress パネル (H5、<private-reference-004> 側) がこの API を read する想定 (Aedilis の
 * HttpServiceConnector と同じ接続パターン)。 Calliope 自身は Corpus 配下ではないため
 * (id532 実装時判明の /api/x/<module> 制約は <private-reference-004> 側プラグインの話で、 Calliope の
 * 自前ルートには適用されない)、 設計文書どおり `/api/<private-reference-004>/progress` を素のパスで公開する。
 */
export function mount<private-reference-004>Routes(app: Hono, deps: <private-reference-004>RoutesDeps) {
  const engine = make<private-reference-004>ProgressEngine(deps);

  app.get('/api/<private-reference-004>/progress', async (c) => {
    try {
      return c.json(await engine.getProgress({ projectId: c.req.query('project_id') }));
    } catch (error) {
      if (error instanceof <private-reference-004>ProgressPrerequisiteError) {
        if (error.missing.length === 1) throw unconfigured(error.missing[0] as string);
        return c.json({ error: '<private-reference-004>_progress_prerequisites_missing', missing: error.missing }, 400);
      }
      return upstreamFailure(error);
    }
  });
}
