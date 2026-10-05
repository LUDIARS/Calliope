// config から Cernere service token の送り口・受け口を組み立てる (認証集約 P4)。
// どちらも設定が欠けていれば null を返し、 呼び出し側は従来の固定トークン経路だけで動く。

import type { CalliopeConfig } from '../config.ts';
import { makeCernerePublicKeySource } from './cernere-public-keys.ts';
import { makeServiceTokenClient, type ServiceTokenClient } from './service-token-client.ts';
import { makeServiceTokenVerifier, type ServiceTokenVerifier } from './service-token-verifier.ts';

export function makeServiceTokenVerifierFromConfig(config: CalliopeConfig): ServiceTokenVerifier | null {
  const cernere = config.cernere;
  if (!cernere?.baseUrl || !cernere.storageSlug) return null;
  return makeServiceTokenVerifier({
    keySource: makeCernerePublicKeySource({ baseUrl: cernere.baseUrl }),
    audience: cernere.storageSlug,
  });
}

export function makeServiceTokenClientFromConfig(config: CalliopeConfig): ServiceTokenClient | null {
  const cernere = config.cernere;
  if (!cernere?.baseUrl || !cernere.clientId || !cernere.clientSecret) return null;
  return makeServiceTokenClient({
    cernereBaseUrl: cernere.baseUrl,
    clientId: cernere.clientId,
    clientSecret: cernere.clientSecret,
  });
}
