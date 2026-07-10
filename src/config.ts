export interface UpstreamConfig {
  baseUrl: string | null;
  token: string | null;
}

export interface CalliopeConfig {
  port: number;
  dbPath: string;
  agentLanes: number;
  serviceToken: string | null;
  llmEstimation: boolean;
  dailyOrchestration?: boolean;
  actio: UpstreamConfig;
  schedula: UpstreamConfig;
  memoria: UpstreamConfig;
  concordiaBaseUrl: string | null;
  nuntiusBaseUrl: string | null;
  claudeBin: string;
}

function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== '') return value;
  }
  return null;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(): CalliopeConfig {
  return {
    port: positiveInteger(process.env.CALLIOPE_PORT, 8891, 'CALLIOPE_PORT'),
    dbPath: process.env.CALLIOPE_DB_PATH ?? './data/calliope.db',
    agentLanes: positiveInteger(process.env.CALLIOPE_AGENT_LANES, 3, 'CALLIOPE_AGENT_LANES'),
    serviceToken: firstEnv('CALLIOPE_SERVICE_TOKEN'),
    llmEstimation: process.env.CALLIOPE_LLM_ESTIMATION !== 'off',
    dailyOrchestration: process.env.CALLIOPE_DAILY_ORCHESTRATION !== 'off',
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
