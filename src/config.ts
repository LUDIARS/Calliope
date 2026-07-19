export interface UpstreamConfig {
  baseUrl: string | null;
  token: string | null;
}

export interface <private-reference-004>UpstreamConfig {
  baseUrl: string | null;
  /** Cernere で検証可能な user bearer (任意、他コネクタと同じ経路)。 */
  token: string | null;
  /** <private-reference-004> requireServiceToken ゲートの固定トークン (X-<private-reference-004>-Service-Token)。 */
  serviceToken: string | null;
}

export interface CalliopeConfig {
  port: number;
  dbPath: string;
  agentLanes: number;
  serviceToken: string | null;
  llmEstimation: boolean;
  dailyOrchestration?: boolean;
  calendarAutoWrite?: boolean;
  weeklyRetrospective?: boolean;
  /** docs/design/<private-reference-004>-pm.md H4: <private-reference-004> 学生 PJ 向け週次進捗レポート (calliope.<private-reference-004>.weekly) 配信。 */
  <private-reference-004>WeeklyReport?: boolean;
  actio: UpstreamConfig;
  schedula: UpstreamConfig;
  memoria: UpstreamConfig;
  /** <private-reference-004> Hub projects レジストリ接続 (docs/design/<private-reference-004>-pm.md §H3)。 H3 実装分のみ、任意設定。 */
  <private-reference-004>?: <private-reference-004>UpstreamConfig;
  concordiaBaseUrl: string | null;
  nuntiusBaseUrl: string | null;
  nuntiusToken?: string | null;
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
    calendarAutoWrite: process.env.CALLIOPE_CALENDAR_AUTO_WRITE === 'on',
    weeklyRetrospective: process.env.CALLIOPE_WEEKLY_RETROSPECTIVE !== 'off',
    <private-reference-004>WeeklyReport: process.env.CALLIOPE_<private-reference-004>_WEEKLY_REPORT !== 'off',
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
    <private-reference-004>: {
      baseUrl: firstEnv('<private-reference-004>_BASE_URL', '<private-reference-004>_API_URL', '<private-reference-004>_URL'),
      token: firstEnv('<private-reference-004>_TOKEN'),
      serviceToken: firstEnv('<private-reference-004>_PROJECTS_SERVICE_TOKEN'),
    },
    concordiaBaseUrl: firstEnv('CONCORDIA_BASE_URL', 'CONCORDIA_URL'),
    nuntiusBaseUrl: firstEnv('NUNTIUS_BASE_URL', 'NUNTIUS_URL'),
    nuntiusToken: firstEnv('NUNTIUS_TOKEN', 'NUNTIUS_PROJECT_TOKEN'),
    claudeBin: process.env.CALLIOPE_CLAUDE_BIN ?? 'claude',
  };
}
