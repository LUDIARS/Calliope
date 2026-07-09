import type { CalliopeConfig } from '../config.ts';
import { makeActioClient } from './actio.ts';
import { makeMemoriaClient } from './memoria.ts';
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
  };
}

export type CalliopeClients = ReturnType<typeof makeClients>;
