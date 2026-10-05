// 上流の service 認可ヘッダを解決する (認証集約 P4 の移行期間)。
//
// Cernere service token を取得できればそれを、 取得できなければ (credentials 未設定 /
// scope 未宣言 / Cernere 不通) 従来の固定トークンを同じヘッダに載せる。 フォールバックは
// 理由コードを 1 行ログに出す (無言にしない)。 固定トークン経路は P5 で撤去する。

import { ServiceTokenUnavailable, type ServiceTokenClient } from '../auth/service-token-client.ts';

export interface ServiceAuthHeaderOptions {
  header: string;
  service: string;
  serviceTokens: ServiceTokenClient | null;
  targetProjectKey: string | null;
  fixedToken: string | null;
  log?: (line: string) => void;
}

export function makeServiceAuthHeader(opts: ServiceAuthHeaderOptions): () => Promise<Record<string, string>> {
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  return async () => {
    if (opts.serviceTokens && opts.targetProjectKey) {
      try {
        return { [opts.header]: await opts.serviceTokens.getToken(opts.targetProjectKey) };
      } catch (error) {
        const reason = error instanceof ServiceTokenUnavailable ? error.reason : 'unknown';
        if (!opts.fixedToken) throw error;
        log(`[calliope] ${opts.service}: service token unavailable (reason=${reason}); using legacy fixed token`);
      }
    }
    return opts.fixedToken ? { [opts.header]: opts.fixedToken } : {};
  };
}
