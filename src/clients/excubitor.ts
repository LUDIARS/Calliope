import { makeHttp } from './http.ts';
import { excubitorServicesResponseSchema } from './contracts.ts';

export interface ExcubitorClientOptions {
  baseUrl: string;
  token: string | null;
}

/** サービスマップが必要とする項目へ正規化した catalog 1行。 */
export interface CatalogService {
  code: string;
  name: string;
  projectCode: string;
  tier: string;
  port: number | null;
  description: string;
  /** Excubitor が観測した稼働状態 (running / stopped / crashed / unknown ...)。 */
  runState: string;
}

function toPort(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : null;
}

export function makeExcubitorClient(opts: ExcubitorClientOptions) {
  const http = makeHttp({ baseUrl: opts.baseUrl, token: opts.token, service: 'excubitor' });

  return {
    health: () => http.get<unknown>('/api/v1/health'),
    /** disabled を除いた LUDIARS サービス一覧 (ポート・稼働状態つき)。 */
    listServices: async (): Promise<CatalogService[]> => {
      const payload = excubitorServicesResponseSchema.parse(
        await http.get<unknown>('/api/v1/services'),
      );
      const services: CatalogService[] = [];
      for (const row of payload.services) {
        const snapshot = row.catalog_snapshot ?? {};
        if (snapshot.disabled) continue;
        const code = row.code || snapshot.code;
        if (!code) continue;
        services.push({
          code,
          name: row.name || snapshot.name || code,
          projectCode: row.project_code || snapshot.project_code || code,
          tier: row.tier || snapshot.tier || 'saas',
          port: toPort(row.port ?? snapshot.port),
          description: snapshot.description ?? '',
          runState: row.state || 'unknown',
        });
      }
      services.sort((a, b) => (a.tier === b.tier ? a.code.localeCompare(b.code) : a.tier.localeCompare(b.tier)));
      return services;
    },
  };
}

export type ExcubitorClient = ReturnType<typeof makeExcubitorClient>;
