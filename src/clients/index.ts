import type { CalliopeConfig } from '../config.ts';
import type { ServiceTokenClient } from '../auth/service-token-client.ts';
import { makeActioClient } from './actio.ts';
import { makeExcubitorClient } from './excubitor.ts';
import { makeProjectHubClient } from './projecthub.ts';
import { makeMemoriaClient } from './memoria.ts';
import { makeNuntiusClient } from './nuntius.ts';
import { makeSchedulaClient } from './schedula.ts';

export function makeClients(config: CalliopeConfig, serviceTokens: ServiceTokenClient | null = null) {
  return {
    actio: config.actio.baseUrl
      ? makeActioClient({ baseUrl: config.actio.baseUrl, token: config.actio.token })
      : null,
    schedula: config.schedula.baseUrl
      ? makeSchedulaClient({ baseUrl: config.schedula.baseUrl, token: config.schedula.token })
      : null,
    memoria: config.memoria.baseUrl
      ? makeMemoriaClient({ baseUrl: config.memoria.baseUrl, token: config.memoria.token })
      : null,
    excubitor: config.excubitor?.baseUrl
      ? makeExcubitorClient({ baseUrl: config.excubitor.baseUrl, token: config.excubitor.token })
      : null,
    nuntius: config.nuntiusBaseUrl && config.nuntiusToken
      ? makeNuntiusClient({ baseUrl: config.nuntiusBaseUrl, token: config.nuntiusToken })
      : null,
    // PROJECTHUB は baseUrl と service 認可 (Cernere service token か固定トークン
    // X-ProjectHub-Service-Token のどちらか) が揃って初めて「設定済み」とみなす (nuntius と同じ流儀)。
    // Cernere bearer (token) は任意 — 未保持環境 (CORPUS_NO_AUTH dev 等) を許容する。
    projecthub: config.projecthub?.baseUrl && (config.projecthub.serviceToken || serviceTokens)
      ? makeProjectHubClient({
          baseUrl: config.projecthub.baseUrl,
          token: config.projecthub.token,
          serviceToken: config.projecthub.serviceToken,
          serviceTokens,
          targetProjectKey: config.projecthub.targetProjectKey ?? null,
        })
      : null,
  };
}

export type CalliopeClients = ReturnType<typeof makeClients>;
