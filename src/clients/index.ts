import type { CalliopeConfig } from '../config.ts';
import { makeActioClient } from './actio.ts';
import { make<private-reference-004>Client } from './<private-reference-004>.ts';
import { makeMemoriaClient } from './memoria.ts';
import { makeNuntiusClient } from './nuntius.ts';
import { makeSchedulaClient } from './schedula.ts';

export function makeClients(config: CalliopeConfig) {
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
    nuntius: config.nuntiusBaseUrl && config.nuntiusToken
      ? makeNuntiusClient({ baseUrl: config.nuntiusBaseUrl, token: config.nuntiusToken })
      : null,
    // <private-reference-004> は baseUrl + serviceToken (X-<private-reference-004>-Service-Token, requireServiceToken 側の
    // 必須ゲート) の両方が揃って初めて「設定済み」とみなす (nuntius と同じ流儀)。
    // Cernere bearer (token) は任意 — 未保持環境 (CORPUS_NO_AUTH dev 等) を許容する。
    <private-reference-004>: config.<private-reference-004>?.baseUrl && config.<private-reference-004>?.serviceToken
      ? make<private-reference-004>Client({
          baseUrl: config.<private-reference-004>.baseUrl,
          token: config.<private-reference-004>.token,
          serviceToken: config.<private-reference-004>.serviceToken,
        })
      : null,
  };
}

export type CalliopeClients = ReturnType<typeof makeClients>;
