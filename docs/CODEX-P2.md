# Codex 実装仕様 — Calliope P2（能力C / Gompertz・inflow / F4 Risk Register）

対象: Codex / full-set implementation。正本は `DESIGN.md`、`docs/design/scheduling.md` §6、
`docs/design/pm-extensions.md` F4。本書はP2実装で固定した契約と受け入れ基準を記録する。

## 1. Definition of Done

1. Actio PMのGompertz・critical-path・task historyをZod検証して取り込む。解析はCalliopeで再実装しない。
2. `K = Θ_p × sprint_days` からバグ予約とinflow予約を控除し、ready taskを解決priority順にcommitする。
3. sprint lifecycle（planned→active→closed）、task状態履歴、日次curve/burndownを永続化する。
4. Memoria `goal_eval`をsprint healthの一次信号に使い、replanで遅延時のscope削減・延長・容量追加案、前倒し時のpull-in候補を返す。
5. close時は次sprintの生成成功後に現activeを閉じ、未完task_refをcarryoverとして返す。
6. goalごとにp50/p80完了予測とdeadlineを比較し、green/amber/redを日次履歴化する。
7. `npm run typecheck`、`npm test`、0003 migrationの初回・再適用がgreen。

## 2. 契約と計算

- 単位は見積り分（E単位）。scope選定で`k_p`を再乗算しない。
- バグ予約 = `max(estimatedTotalBugs - totalBugsFixed, 0) × avgBugEffort`。
- inflow λは直近28日の`created` snapshot件数/日。snapshot欠損taskは`createdAt`を使い、件数をwarningで返す。
- inflow予約 = `λ × sprint_days × avgInflowEffort`。
- priority欠損は暗黙値にせずscore 0使用をwarning、estimate欠損taskはscopeから除外する。
- goal_eval未接続/該当なしはActio完了率へ縮退し、`goal_eval_unavailable` warningを返す。
- riskのp50係数はshrunk `kFactor`、p80は保存済IQRから正規分位間隔で外挿する。
- F4の原文はred/amber条件が重なるため、運用上排他的な判定を採用する:
  `red = p50超過`、`amber = p50内かつp80超過`、`green = p80内`。

## 3. API

- `POST /api/sprint` — `{projectRef, goalRef?, sprintDays?}`からplanned sprintを設計。
- `GET /api/sprint` / `GET /api/sprint/:id` — sprint、task、curve履歴を取得。
- `POST /api/sprint/:id/activate` — project内にactiveがないplannedをactive化。
- `POST /api/sprint/:id/replan` — 日次取込、burndown/health/proposal更新、F4評価。
- `POST /api/sprint/:id/close` — `{createNext?, goalAchieved?}`。既定は次sprintを先に生成してclose。
- `POST /api/risk/refresh` / `GET /api/risk` — goal riskの日次更新・検索。

全`/api/*`はP1のBearer middleware配下。上流未設定は503、非2xx/契約違反は502。

## 4. 永続化

- `sprint`: lifecycle時刻・project/goal参照・期間・target velocity・Gompertz/capacity snapshot。
- `sprint_task`: canonical task_ref、commit時effort/priority、状態と履歴。
- `curve_snapshot`: sprint/date一意、Gompertz、inflow λ、planned/actual burndown。
- `goal_risk_snapshot`: goal/date一意、p50 projected completion、deadline、level、factors。

task本文・氏名・emailは保存しない。red遷移は`notification_required=true`を即時返す。
Nuntiusは認証済project/recipient contextが未設定のため無認証送信せず、`notification_status`で未送信理由を明示する。

## 5. P2の外

- cron/event trigger、自律replan、クロスPJ preemption、confirmation queueはP3。
- Schedula/Google writeはP4。
- Nuntiusの認証済recipient/project bindingは通知基盤側の契約確定後。

## 6. 受け入れ基準

- [x] capacityがbug/inflow予約後にready taskをpriority順で選ぶ。
- [x] snapshot欠損、estimate欠損、priority欠損、Gompertz低信頼を明示する。
- [x] create→activate→replan→risk→close→next plannedが成立する。
- [x] 同一projectのactive重複を409で拒否する。
- [x] curve/riskは同一日の再計算でupsertされ、履歴世代を壊さない。
- [x] p50/p80境界でgreen/amber/redが排他的に決まる。
- [x] migration/typecheck/testがgreen。
