// 環境変数の解決。Excubitor 起動時の別名(_API_URL / _URL)を firstEnv で吸収する。
// 秘密は持たず、上流 URL と service token(Bearer)を env から受け取るだけ。

export interface UpstreamConfig {
  baseUrl: string | null;
  token: string | null;
}

export interface CalliopeConfig {
  port: number;
  dbPath: string;
  agentLanes: number;
  actio: UpstreamConfig;
  schedula: UpstreamConfig;
  memoria: UpstreamConfig;
  concordiaBaseUrl: string | null;
  nuntiusBaseUrl: string | null;
  claudeBin: string;
}

function firstEnv(...keys: string[]): string | null {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== '') return v;
  }
  return null;
}

export function loadConfig(): CalliopeConfig {
  return {
    // ポート正本は Excubitor catalog。8891 は暫定既定。
    port: Number(process.env.CALLIOPE_PORT ?? 8891),
    dbPath: process.env.CALLIOPE_DB_PATH ?? './data/calliope.db',
    agentLanes: Number(process.env.CALLIOPE_AGENT_LANES ?? 3),
    actio: {
      baseUrl: firstEnv('ACTIO_BASE_URL', 'ACTIO_API_URL', 'ACTIO_URL'),
      token: firstEnv('ACTIO_TOKEN'),
    },
    schedula: {
      baseUrl: firstEnv('SCHEDULA_BASE_URL', 'SCHEDULA_API_URL', 'SCHEDULA_URL'),
      token: firstEnv('SCHEDULA_TOKEN'),
    },
    memoria: {
      baseUrl: firstEnv('MEMORIA_BASE_URL', 'MEMORIA_API_URL', 'MEMORIA_URL'),
      token: firstEnv('MEMORIA_TOKEN'),
    },
    concordiaBaseUrl: firstEnv('CONCORDIA_BASE_URL', 'CONCORDIA_URL'),
    nuntiusBaseUrl: firstEnv('NUNTIUS_BASE_URL', 'NUNTIUS_URL'),
    claudeBin: process.env.CALLIOPE_CLAUDE_BIN ?? 'claude',
  };
}
