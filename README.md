# Calliope (カリオペ)

MUSA「9女神」の**長(統括)** — PM秘書オーケストレータ。

Actio(タスク/PM) と Schedula(予定/カレンダー) と Memoria(roadmap/goal評価/AI実行実績) を
**バインドして統括**し、目標に沿った計画を引き、他プロジェクト優先度でリスケし、
バグ収束・実装曲線を加味したスプリントを自動設計・管理する単独サービス。

> **MUSA 原則**: エンジンを二重実装しない。タスク正本=Actio / 予定正本=Schedula /
> 解析=Anatomia / 仕様=Praeforma。Calliope はそれらを呼んで**統合・計画するだけ**の薄い統括層。
> 姉妹サービス [Thaleia](../Thaleia) が「企画↔実装」トレース、Calliope が「**計画↔実行**」トレース + 統括。

略称: `Cp`(提案) / ポート: `8891`(提案、正本は Excubitor catalog)

## 何をするか

| 能力 | 概要 |
|---|---|
| A. AI速度加味スケジュール | 過去実装実績で補正した velocity で所要を見積り、依存順に暦日タイムラインへ配置 |
| B. 他PJ優先度リスケ | roadmap 重要度 + 締切で優先度解決、変化検知で自動再配置(クロスPJ調停) |
| C. スプリント自動管理 | Gompertz バグ収束 + タスク流入曲線を織り込みスコープ設計、日次で健全性監視・再設計 |
| D. Googleカレンダー連動 | Schedula 経由で個人予定を read(空き把握)/ 計画を write(可視化) |
| E. Memoria 目標/タスク引継ぎ | Actio(task/goal正本) + Memoria(roadmap/goal_eval) を read でバインド |

詳細設計は [`DESIGN.md`](DESIGN.md) / [`docs/design/`](docs/design/) を参照。

## 開発

```sh
npm install --include=dev
cp .env.example .env      # 上流 URL/token を設定
npm run db:generate        # drizzle migration 生成
npm run db:migrate         # 適用
npm run dev                # tsx watch で起動 (http://localhost:8891)
npm run typecheck
npm test
```

## P1 API

| Method | Path | 概要 |
|---|---|---|
| POST | /api/estimates/refresh | human→analogy→LLMで未見積りを補完 |
| GET | /api/estimates | task_ref別または全見積り |
| POST | /api/velocity/refresh | 28日velocity + 週次精度を再集計 |
| GET | /api/velocity / /api/velocity/accuracy | 最新velocity / source別精度 |
| POST | /api/priority/refresh | roadmap・goal/task・締切・agingを再解決 |
| GET | /api/priority | scope/refで優先度を取得 |
| POST | /api/plan/generate | DAG×Cレーンでdraft planを生成 |
| GET | /api/plan / /api/plan/:id | plan一覧 / entries込み詳細 |
| POST | /api/plan/:id/apply | draftをactive化し旧activeをsupersede |

CALLIOPE_SERVICE_TOKEN 設定時は全 /api/* にBearerが必要。/health は公開。

## P2 API

| Method | Path | 概要 |
|---|---|---|
| POST | /api/sprint | velocityからbug/inflow予約を控除してplanned sprintを設計 |
| GET | /api/sprint / /api/sprint/:id | sprint一覧 / task・curve込み詳細 |
| POST | /api/sprint/:id/activate | plannedをactive化（projectごとに1件） |
| POST | /api/sprint/:id/replan | 日次burndown・health・scope/期間/容量案・riskを更新 |
| POST | /api/sprint/:id/close | 次plannedを先に生成し、activeをcloseしてcarryoverを返す |
| POST | /api/risk/refresh | critical-path×velocity信頼帯でgoal riskを日次更新 |
| GET | /api/risk | goal_ref/levelでRisk Registerを取得 |

## P5 Dashboard / Weekly Retrospective

Open `/` for the responsive command dashboard. It reads the existing plan, sprint, velocity, briefing, confirmation, calendar, and What-if APIs; the service token is kept in browser session storage only.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/retrospective/weekly` | Aggregate velocity drift, scope creep, aging, estimation accuracy, and reschedule outcomes |
| POST | `/api/retrospective/weekly/send` | Publish one report to the `calliope.weekly` Nuntius topic |

The weekly report runs Monday at 08:00 JST by default. Set `CALLIOPE_WEEKLY_RETROSPECTIVE=off` to disable scheduling.

## P4 Calendar API

| Method | Path | Purpose |
|---|---|---|
| GET/PUT | `/api/calendar/link` | Read or configure the opaque Schedula calendar binding |
| POST | `/api/calendar/sync` | Request plan visualization; confirmation is required unless auto-write is explicitly enabled |
| POST | `/api/calendar/pull` | Trigger Schedula's incremental Google pull sync |

`CALLIOPE_CALENDAR_AUTO_WRITE=on` permits automatic writes only for plan visualization blocks.
Every generated event carries `extendedProperties.private.calliope=<plan_entry_id>` to prevent pull loops.

## P3.5 Daily Briefing API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/briefing/today` | Compose today's JST plan, decisions, alerts, deadlines, and human gates on demand |
| POST | `/api/briefing/today/send` | Publish one aggregated briefing to the `calliope.daily` Nuntius topic |

Set both `NUNTIUS_BASE_URL` and `NUNTIUS_TOKEN` (or `NUNTIUS_PROJECT_TOKEN`) to enable delivery.
When Nuntius is not configured, composition remains available and send returns a warning with `status: skipped`.
The 07:30 JST daily orchestration runs rescheduling first and then sends the same briefing representation.

## P3 API

| Method | Path | 概要 |
|---|---|---|
| POST | /api/reschedule/trigger | event/daily変化からplan diffを生成し低リスクのみauto-apply |
| GET | /api/reschedule/log | proposal/apply/reject/expire監査履歴 |
| GET/POST | /api/confirmations | Decision Inbox一覧・approve/reject |
| POST | /api/plan/simulate | lanes/priority/due変更のDB非書込What-if |

`CALLIOPE_DAILY_ORCHESTRATION=on`（既定）で毎日07:30 JSTに統合ループを実行する。

## 技術スタック

Hono + TypeScript(ESM/NodeNext) + tsx / Drizzle ORM + better-sqlite3(自DB) / vitest。
上流連携は素の `fetch` + Bearer(service token)。構造規約は Thaleia に準拠、永続化は Actio 流。

## 状態

設計 v0.2 / P0基盤 / P1計画生成中核 / P2能力C・Risk Register / P3能力B・自律性を実装済み。
実装仕様は docs/CODEX-P0.md / docs/CODEX-P1.md / docs/CODEX-P2.md / docs/CODEX-P3.md。

## セットアップ TODO (運用)

- [ ] Excubitor catalog に `calliope`(port 8891) を登録(ポート正本化)
- [ ] Cernere に Calliope service 登録 + 上流(Actio/Schedula/Memoria)向け service token 発行
- [ ] Schedula calendar モジュールの双方向化(OAuth consent + write-back)= 別リポ PR(能力D前提)
- [ ] Memoria/Actio の `shareTaskToActio` 拡張(kind/category/creator_type)= 別リポ PR(能力E前提)
