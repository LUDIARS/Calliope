// 上流 HTTP クライアントの共通ヘルパ。各 client(actio/schedula/memoria)は
// このヘルパで request を組む。規約: 末尾スラッシュ正規化 / token あるときのみ Bearer /
// 非 2xx は無言フォールバックせず throw(route 側で 502/503 に写す)。

export interface HttpClientOptions {
  baseUrl: string;
  token: string | null;
  service: string; // エラーメッセージ用のサービス名
}

export class UpstreamError extends Error {
  constructor(public service: string, public path: string, public status: number, body?: string) {
    super(`${service} ${path} -> HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'UpstreamError';
  }
}

export function makeHttp(opts: HttpClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, '');

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new UpstreamError(opts.service, path, res.status, text);
    }
    return (await res.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    del: <T>(path: string) => request<T>('DELETE', path),
  };
}
