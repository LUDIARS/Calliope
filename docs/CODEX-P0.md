# Codex 委託仕様 — Calliope P0 (基盤: 自DB + コネクタ + health)

対象: Codex / 設計: Claude(Opus) / full-set-implementation 準拠(MVP で削らない)。
先に読む: [`../DESIGN.md`](../DESIGN.md) §3,§4 / [`design/scheduling.md`](design/scheduling.md) §2 / [`design/calendar-memoria.md`](design/calendar-memoria.md) E。

---

## 0. P0 のゴール(Definition of Done)

Calliope の**基盤**を完成させる。上位ロジック(スケジュール/リスケ/スプリント)は P1 以降。P0 の DoD:

1. 自 DB スキーマ(DESIGN §3 の全テーブル)が drizzle で定義され、migration 生成・適用が通る。
2. 上流3サービス(Actio / Schedula / Memoria)への **read コネクタ**が実装され、実サービスに疎通する。
3. `/health` が上流疎通状況を返し、`connector_state` に health を記録する。
4. `npm run typecheck` / `npm test` green。`npm run dev` で起動し `/health` が 200。

## 1. 既に scaffold 済み(再実装しない)

以下は Claude が用意済み。**土台として使い、壊さない**:
- `package.json` / `tsconfig.json`(ESM/NodeNext, import は `.ts` 拡張子) / `drizzle.config.ts` / `.env.example` / `.gitignore`
- `src/index.ts`(Hono + `/health` + serve。route mount 追加ポイントに TODO コメント)
- `src/config.ts`(`loadConfig()` = port/dbPath/agentLanes/上流{baseUrl,token}/concordia/nuntius/claudeBin)
- `src/clients/http.ts`(`makeHttp` = fetch + 末尾スラッシュ正規化 + token あるとき Bearer + `UpstreamError` throw)
- `src/db/client.ts`(`openDb` = better-sqlite3 + drizzle, WAL) / `src/db/migrate.ts`
- `src/db/schema.ts`(seed: `connector_state` のみ。残りを実装するのが P0-T1)

## 2. タスク分解

### T1. DB スキーマ(全テーブル) — `src/db/schema.ts`
DESIGN §3 の全テーブルを drizzle(sqlite-core)で実装。フィールドは DESIGN §3 と `design/scheduling.md §7` を正とする:
- `plan`(id, goal_ref, period_start, period_end, status[draft/active/superseded], velocity_snapshot JSON, created_at, superseded_by)
- `plan_entry`(id, plan_id FK, task_ref(source+external/local id), start_at, end_at, lane, seq, schedula_event_id, confidence, is_human_gate)
- `sprint`(id, project_ref, goal_ref, period_start, period_end, target_velocity, gompertz_snapshot JSON, status[planned/active/closed])
- `sprint_task`(id, sprint_id FK, task_ref, status_history JSON)
- `velocity`(id, project_ref, category, window_start, window_end, k_factor, throughput, distribution JSON, sample_size, source)
- `task_estimate`(task_ref PK, effort_minutes, estimate_source[human/analogy/llm], confidence, estimated_at)
- `reschedule_log`(id, trigger, before JSON, after JSON, applied_by[human/auto], reason, created_at)
- `priority`(id, scope[project/goal/task], ref, resolved_score, breakdown JSON, updated_at)
- `curve_snapshot`(id, sprint_id FK, date, gompertz_params JSON, inflow_lambda, burndown_actual, burndown_planned)
- `calendar_link`(id, google_calendar_id, sync_direction[read/write/both], enabled, updated_at)
- `connector_state`(seed 済、必要なら拡張)

**注**: 個人データ列を作らない。task/event/goal は `*_ref` の id 参照 + 非個人フィールドのみ。
完了後 `npm run db:generate` → `npm run db:migrate` が通ること。

**2026-07-09 レビュー反映(as-built 修正)**:
- `calendar_link.google_calendar_id` → **`calendar_ref`** に変更(`'primary'` or Schedula 参照 id。
  primary の生 ID は email そのものになるため保存しない。calendar-memoria.md D.3)。
- task/goal 参照は正規文字列形 **`actio:<taskId>` / `actio-pm:<projectId>/<externalId>`** に統一。
  `plan_entry.task_ref` / `sprint_task.task_ref` の JSON 参照を text に変更(DESIGN §3)。

### T2. リポジトリ層 — `src/db/repository.ts`
各テーブルの CRUD を集約(ルートから直接 db を触らない = Actio 規約に倣う)。P0 では `connector_state` の upsert/read と、plan/velocity の基本 insert/select を用意(上位で使う最小)。

### T3. ActioConnector — `src/clients/actio.ts`
`makeActioClient({ baseUrl, token })` factory(`makeHttp` 使用)。read メソッド:
- `listTasks()` → `GET /api/tasks`(kind/status/category/priority/due/estimatedMinutes/completedAt/creatorType)
- `listPmTasks(projectId)` → `GET /api/pm/projects/:projectId/tasks`(pm_tasks: externalId/status/priority/labels/blockedBy/dueDate/milestone)
- `getGompertz(projectId)` → `GET /api/pm/projects/:projectId/analytics/gompertz`(estimatedTotalBugs/convergenceDate/confidence)
- `getCriticalPath(projectId)` → `GET /api/pm/projects/:projectId/analytics/critical-path`(longest path/projectedCompletionDate/riskLevel)
- `listPmProjects()` → `GET /api/pm/projects`
- (write は P1 以降。P0 は read のみ)

**検証済(2026-07-09)**: 上記パスは P0 実装(`src/clients/actio.ts`)で確定。認証は Cernere service token(Bearer)。

### T4. SchedulaConnector — `src/clients/schedula.ts`
- `listEvents(range)` → `GET /api/events`
- `listPersonalEvents()` → `GET /api/calendar/personal` / `listCalendarEvents(range)` → `GET /api/calendar/events`
- `getCalendarStatus()` → `GET /api/calendar/status`
- `freeBusy(range)` → **P4a で Schedula 側に追加**。P0 実装では未着手(レビュー指摘 A-2)。
  **P1c で Calliope 側合成の近似 freeBusy(events + personal_events)を実装**し、P4b で Schedula 版へ差し替える(scheduling.md §4.3)。

**検証済(2026-07-09)**: 上記パスは P0 実装(`src/clients/schedula.ts`)で確定。smart-scheduler 系(`getScheduling`)は P1c で必要になった時点で追加。

### T5. MemoriaConnector — `src/clients/memoria.ts`(read-only)
- `getRoadmaps()` → `GET /api/roadmaps`(line/member importance)
- `getGoalEvals(month)` → `GET /api/goal-evals?month=`
- `listAgentRuns()` → `GET /api/agent-runs`(velocity 元)。**検証済(2026-07-09)**: パスは P0 実装(`src/clients/memoria.ts`)で確定。
- 注意: Memoria は multi モードで `/api/tasks` 等が `local_only`(503)。roadmap/goal-evals の multi 挙動を確認し、local_only の場合は fallback(roadmap-* JSON 直読)を検討。

### T6. health 拡張 + route mount 雛形 — `src/index.ts` / `src/routes/`
- `/health` を拡張: 各上流に軽い ping(例 `GET {base}/health` or 既知の軽 endpoint)し、結果を `connector_state` に upsert、レスポンスに health を含める。
- `src/routes/` を作り、`mountHealthRoutes` 等の `mount*Routes(app, config, deps)` パターンを確立(Thaleia 準拠)。plan/sprint 等の空 route は P1 以降。

### T7. テスト — `__tests__/` コロケーション
- `src/clients/__tests__/http.test.ts`: `makeHttp` の Bearer 付与・末尾スラッシュ・非2xx throw を fetch mock で。
- 各 connector: レスポンス正規化を fixture でテスト(実サービス不要)。
- 純粋関数が増えたら同フォルダに追加。

## 3. 受け入れ基準

- [ ] `npm run db:generate && npm run db:migrate` が成功し全テーブル作成。
- [ ] `.env` に上流 URL/token を設定 → `npm run dev` → `GET /health` が上流 health を反映して 200。
- [ ] 3コネクタの read メソッドが実サービスに疎通(手動 or 統合テスト)。
- [ ] `npm run typecheck` / `npm test` green。
- [ ] 上流未設定は 503(`{error:'<svc>_unconfigured'}`)、非2xx は `UpstreamError` を route で 502 に写す(無言フォールバック禁止)。

## 4. 規約(必須)

- `../CLAUDE.md` 準拠: SRP / ファイル分割 / ESM+`.ts`拡張子 / 無言フォールバック禁止 / 個人データ非保持。
- `feat/*` ブランチ → 1 PR に集約 → typecheck+test green で PR。**main 直 push 禁止**。
- 純粋ロジックに上流 I/O を持ち込まない(fixture テスト可能に保つ)。

## 5. P0 完了後

P1(velocity + EstimationService + priority + 能力A スケジューラ)へ。詳細は `design/scheduling.md §2-4`。
