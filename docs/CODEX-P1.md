# Codex 委託仕様 — Calliope P1 (velocity / 見積り / priority / 能力A スケジューラ / plan)

対象: Codex / 設計: Claude(Opus) / full-set-implementation 準拠(MVP で削らない)。
先に読む: [`../DESIGN.md`](../DESIGN.md) §3,§5,§7 / [`design/scheduling.md`](design/scheduling.md) §2-§4(2026-07-09 改訂版) /
[`design/calendar-memoria.md`](design/calendar-memoria.md) E.4 / [`design/pm-extensions.md`](design/pm-extensions.md) F5。
サブフェーズ: **P1a**(velocity+見積り+F5) → **P1b**(priority) → **P1c**(スケジューラ+plan)。この順に依存する。

---

## 0. P1 のゴール(Definition of Done)

P0 基盤(自DB + read コネクタ + health)の上に**計画生成の中核**を実装する:

1. **P1a**: Memoria `agent_runs` + Actio 完了タスクから velocity(k_p / Θ_p / 分布 / sample_size)を算出・永続化。
   未見積りタスクを EstimationService(analogy → LLM)で補完。F5 精度トラッキング同梱。
2. **P1b**: roadmap importance + goal/task priority + 締切 + aging から合成優先度 P(t) を解決・永続化。
3. **P1c**: 依存 DAG × C レーン list scheduling で `plan`/`plan_entry` を生成。近似 freeBusy で人間ゲートを配置。
   `POST /api/plan/generate` → draft、`POST /api/plan/:id/apply` → active 昇格(supersede 版管理)。
4. `npm run typecheck` / `npm test` green。純粋ロジックは全て fixture テスト。

**P1 でやらないこと**: Schedula/Google への write(P4)、リスケ・トリガ・cron・自律性 409(P3)、
スプリント(P2)、confirmation テーブル(P3)、roadmap の fallback 直読(P3)。

## 1. 共通規約(全タスク適用)

- **task_ref 正規形**(DESIGN §3): `actio:<taskId>` / `actio-pm:<projectId>/<externalId>`。
  生成・解決は 1 モジュール(`src/refs.ts`)に集約し、パース関数(`parseTaskRef`)と共にテストする。
- **velocity 番兵**(scheduling.md §2.3): カテゴリ横断行 = `category='*'`、全PJ横断(k_0 用)= `project_ref='*'`。
- **レイヤ分離**(CLAUDE.md): feature フォルダ(純粋ロジック + `engine.ts`)/ `routes/` / `clients/` / `db/`。
  **純粋関数(calc/score/scheduler/freebusy)に I/O を持ち込まない。**
- **無言フォールバック禁止**: 上流未設定 503 / 非2xx は `UpstreamError` → 502(P0 の `routes/errors.ts` を再利用)。
  多段の見積り補完(human→analogy→llm→未推定)は**仕様上の段階**なので可。ただし各段の結果と
  「未推定のまま残った task」をレスポンスに明示する(黙って落とさない)。
- 時刻は ISO 8601 文字列(P0 踏襲)。数値時間は「分」単位で統一。

## 2. タスク分解

### P1a — Velocity + EstimationService + F5

#### T1. 参照ユーティリティ — `src/refs.ts`
`makeTaskRef(source, ...ids)` / `parseTaskRef(ref)`。上記正規形のみ受理、不正形式は throw。

#### T2. velocity 純粋ロジック — `src/velocity/calc.ts`
入力: `{ taskRef, category, projectRef, estimateMinutes, actualMinutes, completedAt }[]` + window(既定 28日)。
- `k_p = median(actual/estimate)`(estimate>0 の完了タスクのみ)。
- **ベイズ収縮**(§2.3 確定式): `k' = (n·k + 5·k_0)/(n + 5)`。k_0 = 全PJ横断 median(横断 n≥5)、無ければ 1。
- `Θ_p = Σ estimate(完了)/window_days`(E単位/日)。
- 分布: actual/estimate 比の p25/p50/p75(IQR)を `distribution` JSON に。
- 出力行: (project_ref, category) の組 + `category='*'` 集約行 + `project_ref='*'` 横断行。各行に sample_size。

#### T3. velocity engine — `src/velocity/engine.ts`
- 入力収集: `MemoriaConnector.listAgentRuns()`(D_t の一次ソース: finished_at - started_at)+
  `ActioConnector.listTasks()`(creatorType='ai' 完了分の estimatedMinutes / completedAt)。
  agent_runs と task の突合は task_id → task_ref。estimate は Actio 値 → 無ければ `task_estimate` 表(T5)。
- calc(T2) → `velocity` テーブルへ window ごと insert(同 window 再計算は置換。破壊更新ではなく
  window キーで世代管理: 同一 (project_ref, category, window_start, window_end) は delete+insert で可)。

#### T4. F5 精度トラッキング — `src/velocity/accuracy.ts`(純粋)+ engine 統合
- source(human/analogy/llm)別に MAPE / bias(mean(actual-estimate)/estimate)/ sample_size を週次 window で算出。
- 保存は `velocity.distribution` に `accuracyBySource` として同梱(新テーブル不要。pm-extensions.md F5)。

#### T5. EstimationService — `src/estimation/`
- `analogy.ts`(純粋): 同 category(+ラベル一致があれば優先)の完了タスク実所要 median を割当。
  confidence = n/(n+5)。類似 3 件未満は不採用(null を返す)。
- `llm.ts`(I/O): `config.claudeBin` で `claude -p` を子プロセス実行し、title/details から S/M/L を判定。
  分換算既定: **S=60 / M=240 / L=720**(定数、将来設定化)。タイムアウト 60s。失敗は throw(握り潰さない)。
- `engine.ts`: 未見積りタスク列挙 → human(Actio 値あり)/ analogy / llm の順で決定 →
  `task_estimate` upsert(estimate_source / confidence / estimated_at)。実績確定時の上書き学習は
  velocity engine 側で completedAt 付き task を検出して再 upsert(source は維持し actual を distribution へ)。
- LLM 不使用運用向けに `CALLIOPE_LLM_ESTIMATION=off` で llm 段をスキップ可(スキップは結果に明示)。

#### T6. routes — `src/routes/velocity.ts` / `src/routes/estimates.ts`
- `POST /api/velocity/refresh` → T3 実行、生成行サマリを返す。
- `GET /api/velocity?project=&category=` → 最新 window の行。
- `GET /api/velocity/accuracy` → F5 集計。
- `POST /api/estimates/refresh` → T5 実行。レスポンスに `{estimated: n, skipped_llm: n, unresolved: [task_ref...]}`。
- `GET /api/estimates?task_ref=`。

### P1b — Priority

#### T7. migration — `priority.first_ready_at`
`priority` テーブルに `first_ready_at TEXT NULL` を追加(§3.2 aging の起点)。`npm run db:generate` で 0002 生成。

#### T8. priority 純粋ロジック — `src/priority/score.ts`
scheduling.md §3.2(2026-07-09 改訂)を忠実に:
- 正規化: task/goal priority low/med/high/critical → 0.25/0.5/0.75/1.0。roadmap importance 1-3 → /3。
- `urgency`: due 無し=0 / days_to_due≥0 は clamp((H-days)/H,0,1)(H=30日既定)/ 超過=1 +
  breakdown に `overdue_days` 記録。
- `aging = min(wait_days/14, 1)`。wait 起点 = `first_ready_at`(初回解決時に現在時刻をセット、以後不変)。
- weights 既定(定数モジュール `src/priority/weights.ts`、将来設定化): w1=0.35 / w2=0.25 / w3=0.20 / w4=0.15 / w5=0.05。
- 手動 override(`priority` 行の明示指定)があれば該当項を固定。
- 出力: `{ resolvedScore, breakdown: {proj, goal, task, urgency, aging, overdue_days?} }`。

#### T9. priority engine + routes — `src/priority/engine.ts` / `src/routes/priority.ts`
- 入力: `MemoriaConnector.getRoadmaps()`(line/member importance。**Memoria 未設定は 503** — fallback 直読は P3)、
  `ActioConnector.listTasks()`(kind=goal と通常 task)、`listPmTasks()`。
- goal↔task の紐付けは category + goal 参照(E.5。緩い紐付けで可、`breakdown.goal` が取れない task は goal 項 0)。
- `POST /api/priority/refresh` → 全対象を解決し `priority` upsert(scope=project/goal/task)。
- `GET /api/priority?scope=&ref=`。

### P1c — 能力A スケジューラ + plan

#### T10. DAG — `src/scheduler/dag.ts`(純粋)
- pm_tasks の `blockedBy` から DAG 構築 → topological sort。
- **閉路検出**: 検出したら閉路の task_ref 一覧を含む error を throw(自動解決しない。§8)。route は 422 で返す。

#### T11. 近似 freeBusy — `src/scheduler/freebusy.ts`(純粋)+ connector 結線
- 純粋部: イベント `{start,end}[]` → busy 区間 merge → range 内の free slot 列挙、`nextFreeSlot(from, minutes)`。
- 結線部(engine 内): `SchedulaConnector.listEvents + listPersonalEvents` を合成(scheduling.md §4.3 の
  P1c 近似。**インタフェースは `freeBusy(range)` とし、P4b で Schedula 版 `/api/calendar/freebusy` に差し替え可能に**)。
- Schedula 未設定時: 人間ゲートを「未定枠」(start/end null, lane='human-pending')として plan に残し、
  レスポンスに警告を明示(D.6 の degrade 準拠。黙って進めない)。

#### T12. list scheduling — `src/scheduler/listSchedule.ts`(純粋)
scheduling.md §4.2 を忠実に:
- 入力: topo 済みタスク(D̂_t = E_t × k'_p、P(t)、isHumanGate)、レーン数 C(`config.agentLanes`)、freeBusy、開始時刻。
- ready 集合から P(t) 最大を取り、AI タスクは earliest free lane(24h 連続稼働)、
  人間ゲートは `nextFreeSlot` かつ**営業時間窓 09:00-18:00(定数、将来設定化)**内に配置。
- 人間ゲート判定(§9-3 初期定義): task kind='goal'(承認)または pm_tasks ラベルに `human-gate`。
  `gate_minutes` 既定 30(k_p 非適用。§4.2)。
- entry confidence = `(n/(n+5)) × (1 - min((p75-p25)/p50, 1))`(velocity sample_size と IQR 幅から。
  velocity 行が無い task は 0.2 固定で「暫定」扱い)。
- 出力: `{ taskRef, startAt, endAt, lane, seq, confidence, isHumanGate }[]`。

#### T13. plan engine + routes — `src/scheduler/engine.ts` / `src/routes/plan.ts`
- `POST /api/plan/generate` body `{ goalRefs?: string[], horizonDays?: number(既定30) }`:
  velocity/priority/estimate を読み(古ければ 400 で refresh を促す、または query `refresh=true` で先に実行)、
  T10-T12 を通して **draft plan + plan_entry[] を保存**して返す。velocity スナップは `plan.velocity_snapshot` へ。
- `GET /api/plan`(status filter)/ `GET /api/plan/:id`(entries 込み)。
- `POST /api/plan/:id/apply`: draft → active。既存 active は `status=superseded` + `superseded_by=新id`。
  **P1 の apply はここまで**(Schedula 予定化は P4。`schedula_event_id` は null のまま)。
  自律性判定(409)は P3 — P1 では apply は常に成功(低リスク操作のみのため)し、
  結果を `reschedule_log` に `{trigger:'manual_apply', applied_by:'human'}` で記録する。
- 未見積りタスクは plan に**入れない**(§8)。除外一覧をレスポンス `warnings.unestimated` に明示。
- `horizonDays` を超えて終了する entry は plan に入れず、`warnings.outsideHorizon` に task_ref を明示する。

### 横断

#### T14. 認証 middleware — `src/routes/auth.ts`
DESIGN §7(C-3): env `CALLIOPE_SERVICE_TOKEN` 設定時は全 `/api/*` に Bearer 必須(不一致 401)。
未設定時は認証スキップ + 起動時に警告ログ 1 行。`/health` は常に公開。`app.ts` で mount。

#### T15. repository 拡張 — `src/db/repository.ts`
task_estimate / priority / plan_entry / reschedule_log の upsert・select を追加。
plan の supersede 遷移(active→superseded + superseded_by)をトランザクションで。
ファイルが肥大するなら `src/db/repositories/<table>.ts` に分割(SRP)。

#### T16. テスト — 各 feature `__tests__/` コロケーション
- `velocity/calc`: k_p median / ベイズ収縮(n<5, n≥5)/ 番兵行 / IQR を fixture で。
- `estimation/analogy`: 類似3件未満で null / median 割当。llm はプロセス呼び出しを mock。
- `priority/score`: urgency 3 ケース(due無し/通常/超過)+ aging 上限 + override 固定。
- `scheduler/dag`: topo 順 / 閉路 throw。
- `scheduler/freebusy`: 区間 merge / 跨ぎ / 空き列挙 / nextFreeSlot。
- `scheduler/listSchedule`: 依存順守 / レーン割付 / 人間ゲートの営業時間窓 / 未見積り除外。
- routes: 503(未設定)/ 401(token 不一致)/ 422(閉路)/ plan generate→apply の supersede 遷移。

## 3. 受け入れ基準

- [x] `npm run db:generate && npm run db:migrate` が 0002(first_ready_at)まで適用。
- [x] `POST /api/velocity/refresh` → `GET /api/velocity` の実データ契約を実装・integration fixtureで検証。live rollout は [`CODEX-ROLLOUT.md`](CODEX-ROLLOUT.md) の外部前提に分離。
- [x] `POST /api/estimates/refresh` が human/analogy/llm の段階を踏み、未推定を unresolved で明示。
- [x] `POST /api/priority/refresh` → `GET /api/priority` が breakdown(urgency/aging 含む)付きで返す。
- [x] `POST /api/plan/generate` → draft(velocity_snapshot・confidence・human gate 配置あり)、
      `POST /api/plan/:id/apply` → active + 旧 plan supersede + reschedule_log 記録。
- [x] Schedula 未設定でも generate が degrade(human-pending + 警告)で完走する。
- [x] `CALLIOPE_SERVICE_TOKEN` 設定時に token 無しの `/api/*` が 401、`/health` は 200。
- [x] `npm run typecheck` / `npm test` green。純粋ロジックは fixture のみで通る(上流 mock 不要)。

## 4. 規約(必須)

- `../CLAUDE.md` 準拠: SRP / ESM+`.ts` 拡張子 / 無言フォールバック禁止 / 個人データ非保持
  (velocity/estimate/priority/plan の全行が task_ref 参照のみ。title 等の本文を自DB に複製しない)。
- `feat/*` ブランチ → 1 PR に集約 → typecheck+test green で PR。**main 直 push 禁止**。

## 5. P1 完了後

P2(能力C スプリント設計/管理 + gompertz/inflow 取込 + F4 Risk Register)へ。
詳細は `design/scheduling.md §6`(E単位規約に注意)と `design/pm-extensions.md` F4。
