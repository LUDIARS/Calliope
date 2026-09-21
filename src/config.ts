export interface UpstreamConfig {
  baseUrl: string | null;
  token: string | null;
}

export interface ProjectHubUpstreamConfig {
  baseUrl: string | null;
  /** Cernere で検証可能な user bearer (任意、他コネクタと同じ経路)。 */
  token: string | null;
  /** PROJECTHUB requireServiceToken ゲートの固定トークン (X-ProjectHub-Service-Token)。 */
  serviceToken: string | null;
}

export interface CalliopeConfig {
  port: number;
  dbPath: string;
  agentLanes: number;
  serviceToken: string | null;
  /**
   * クロスオリジンで `/api/*` を叩けるオリジンの allowlist (`CALLIOPE_CORS_ORIGINS`, カンマ区切り)。
   * 既定は空 = 同一オリジンのみ。 ダッシュボードは同一オリジン配信なので既定で足りる。
   */
  corsOrigins?: string[];
  /** サービスマップ admin API の任意追加 Bearer。未設定時の認可は Cloudflare Access に委ねる。 */
  serviceMapAdminToken?: string | null;
  /** サービスマップの遅延自動同期の鮮度 (分)。閲覧時にこの分数より古ければ Excubitor から取り直す。 */
  serviceMapSyncMinutes?: number;
  llmEstimation: boolean;
  dailyOrchestration?: boolean;
  calendarAutoWrite?: boolean;
  weeklyRetrospective?: boolean;
  /** docs/design/projecthub-pm.md H4: PROJECTHUB 学生 PJ 向け週次進捗レポート (calliope.projecthub.weekly) 配信。 */
  projecthubWeeklyReport?: boolean;
  /** docs/design/task-lifecycle.md §G3: タスク棚卸し (週次 + on-demand) を有効化するか。 */
  taskStocktake?: boolean;
  /** docs/design/task-lifecycle.md §G2: タスク自動生成 (日次 + on-demand) を有効化するか。 */
  taskGenerate?: boolean;
  /** §G3 検出閾値 (env 可変)。 aging 既定 14 日、 priority 乖離既定 2 バケット。 */
  stocktake?: { agingDays: number; priorityGap: number };
  actio: UpstreamConfig;
  schedula: UpstreamConfig;
  memoria: UpstreamConfig;
  /** Excubitor (サービス catalog / 稼働状態の正本)。サービスマップの同期元。 */
  excubitor?: UpstreamConfig;
  /** PROJECTHUB Hub projects レジストリ接続 (docs/design/projecthub-pm.md §H3)。 H3 実装分のみ、任意設定。 */
  projecthub?: ProjectHubUpstreamConfig;
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
  // 空文字は「未設定」扱い (`.env` の `KEY=` は本リポの既定表記)。 Number('') は 0 になり
  // 起動を落とすため、 firstEnv と同じ空値セマンティクスに揃える。
  const parsed = Number(value === undefined || value === '' ? fallback : value);
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
    corsOrigins: (firstEnv('CALLIOPE_CORS_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    serviceMapAdminToken: firstEnv('CALLIOPE_SERVICEMAP_ADMIN_TOKEN'),
    serviceMapSyncMinutes: positiveInteger(process.env.CALLIOPE_SERVICEMAP_SYNC_MINUTES, 10, 'CALLIOPE_SERVICEMAP_SYNC_MINUTES'),
    llmEstimation: process.env.CALLIOPE_LLM_ESTIMATION !== 'off',
    dailyOrchestration: process.env.CALLIOPE_DAILY_ORCHESTRATION !== 'off',
    calendarAutoWrite: process.env.CALLIOPE_CALENDAR_AUTO_WRITE === 'on',
    weeklyRetrospective: process.env.CALLIOPE_WEEKLY_RETROSPECTIVE !== 'off',
    projecthubWeeklyReport: process.env.CALLIOPE_PROJECTHUB_WEEKLY_REPORT !== 'off',
    taskStocktake: process.env.CALLIOPE_TASK_STOCKTAKE !== 'off',
    taskGenerate: process.env.CALLIOPE_TASK_GENERATE !== 'off',
    stocktake: {
      agingDays: positiveInteger(process.env.CALLIOPE_STOCKTAKE_AGING_DAYS, 14, 'CALLIOPE_STOCKTAKE_AGING_DAYS'),
      priorityGap: positiveInteger(process.env.CALLIOPE_STOCKTAKE_PRIORITY_GAP, 2, 'CALLIOPE_STOCKTAKE_PRIORITY_GAP'),
    },
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
    excubitor: {
      baseUrl: firstEnv('EXCUBITOR_BASE_URL', 'EXCUBITOR_API_URL', 'EXCUBITOR_URL'),
      token: firstEnv('EXCUBITOR_TOKEN'),
    },
    projecthub: {
      baseUrl: firstEnv('PROJECTHUB_BASE_URL', 'PROJECTHUB_API_URL', 'PROJECTHUB_URL'),
      token: firstEnv('PROJECTHUB_TOKEN'),
      serviceToken: firstEnv('PROJECTHUB_PROJECTS_SERVICE_TOKEN'),
    },
    concordiaBaseUrl: firstEnv('CONCORDIA_BASE_URL', 'CONCORDIA_URL'),
    nuntiusBaseUrl: firstEnv('NUNTIUS_BASE_URL', 'NUNTIUS_URL'),
    nuntiusToken: firstEnv('NUNTIUS_TOKEN', 'NUNTIUS_PROJECT_TOKEN'),
    claudeBin: process.env.CALLIOPE_CLAUDE_BIN ?? 'claude',
  };
}
