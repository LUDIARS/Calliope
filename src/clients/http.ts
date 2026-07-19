export interface HttpClientOptions {
  baseUrl: string;
  token: string | null;
  service: string;
  /** additional fixed headers (e.g. <private-reference-004>'s X-<private-reference-004>-Service-Token gate) */
  headers?: Record<string, string>;
}

export class UpstreamError extends Error {
  constructor(public service: string, public path: string, public status: number) {
    super(`${service} ${path} -> HTTP ${status}`);
    this.name = 'UpstreamError';
  }
}

export function makeHttp(opts: HttpClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, '');

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new UpstreamError(opts.service, path, res.status);
    }
    try {
      return await res.json() as T;
    } catch {
      throw new UpstreamError(opts.service, path, res.status);
    }
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    del: <T>(path: string) => request<T>('DELETE', path),
  };
}
