// Cernere service token の送り側取得 (認証集約 P4)。
//
// 自分の project client credentials を Cernere にだけ提示し、 呼出先ごとの短命 token を得る。
// token は process memory にだけ置き、 期限の 60 秒前まで使い回す。 ディスクやログへは書かない。

export class ServiceTokenUnavailable extends Error {
  /** ログに出せる理由コード (HTTP status か network / malformed)。 秘密値は含めない。 */
  constructor(public readonly reason: string) {
    super(`service token unavailable (${reason})`);
    this.name = 'ServiceTokenUnavailable';
  }
}

export interface ServiceTokenClientOptions {
  cernereBaseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshMarginMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface ServiceTokenClient {
  getToken(targetProjectKey: string): Promise<string>;
}

const DEFAULT_REFRESH_MARGIN_MS = 60 * 1000;

export function makeServiceTokenClient(opts: ServiceTokenClientOptions): ServiceTokenClient {
  const url = `${opts.cernereBaseUrl.replace(/\/+$/, '')}/api/auth/service-token`;
  const margin = opts.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { token: string; expiresAt: number }>();

  async function issue(targetProjectKey: string): Promise<string> {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        target_project_key: targetProjectKey,
      }),
    }).catch(() => null);
    if (!res) throw new ServiceTokenUnavailable('network');
    if (!res.ok) {
      await res.body?.cancel();
      throw new ServiceTokenUnavailable(String(res.status));
    }
    const body = await res.json().catch(() => null) as { accessToken?: unknown; expiresIn?: unknown } | null;
    if (!body || typeof body.accessToken !== 'string' || typeof body.expiresIn !== 'number') {
      throw new ServiceTokenUnavailable('malformed');
    }
    cache.set(targetProjectKey, { token: body.accessToken, expiresAt: now() + body.expiresIn * 1000 });
    return body.accessToken;
  }

  return {
    getToken: async (targetProjectKey) => {
      const hit = cache.get(targetProjectKey);
      if (hit && hit.expiresAt - margin > now()) return hit.token;
      return issue(targetProjectKey);
    },
  };
}
