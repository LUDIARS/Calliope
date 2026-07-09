# Calliope 設計書 (概要・正本)

MUSA 統括 / PM秘書オーケストレータ。詳細アルゴリズムは分冊:
- A/B/C(スケジュール/リスケ/スプリント) → [`docs/design/scheduling.md`](docs/design/scheduling.md)
- D/E(Googleカレンダー/Memoria引継ぎ) → [`docs/design/calendar-memoria.md`](docs/design/calendar-memoria.md)
- PM運用拡張 F1-F7(承認キュー/ブリーフィング/リスク/精度) → [`docs/design/pm-extensions.md`](docs/design/pm-extensions.md)
- 実装フェーズ(Codex 委託) → [`docs/CODEX-P0.md`](docs/CODEX-P0.md) / [`docs/CODEX-P1.md`](docs/CODEX-P1.md)
- 仕様レビュー(2026-07-09, 反映済) → [`docs/reviews/2026-07-09-spec-review.md`](docs/reviews/2026-07-09-spec-review.md)

---

## 0. 位置づけ

- **Calliope = MUSA「9女神」の長(統括)**。従来 `Ars-Musa/docs/DESIGN.md §4-A` で未実装だった統括シェルに、
  PM秘書としての実体を与える。UX の語は Thaleia(`/api/ux/*`)に寄せ、Calliope は純統括。
- **中核原則(MUSA/Thaleia 継承): エンジンを二重実装しない。バインド/統括に徹する。**
- 姉妹: Thaleia = 「企画↔実装」トレース、Calliope = 「**計画↔実行**」トレース + 統括。

## 1. スコープ

**する**: 目標→タスク→予定の統合計画 / AI実装速度(velocity)加味スケジュール /
他PJ優先度リスケ / バグ収束・実装曲線加味のスプリント自動設計・管理 /
Googleカレンダー個人予定連動 / 外部PM(GitHub/Linear/Notion)バインド(**保留**)。

**しない(各サービスが正本)**: タスク/目標正本=Actio、予定/カレンダー=Schedula、
個人プロファイル/認証=Cernere、コード解析=Anatomia、仕様=Praeforma、
AI実行実績/roadmap=Memoria、Unity女神モジュール起動停止(将来 Calliope-Unity 側)。

## 2. アーキテクチャ上の位置

- **形態**: 単独オーケストレーションサービス。Hono + TS(ESM/NodeNext) + tsx。独自リポ `Calliope`(略称 `Cp`, port 8891 提案)。
- **自 DB**: 計画成果物のみ(SQLite/drizzle)。task/event/goal は id 参照。
- **データ所在(SoT境界)**:

| データ | 正本 | Calliope |
|---|---|---|
| タスク/目標 | Actio(`tasks`,`pm_tasks`) | id 参照 read/write |
| 予定/カレンダー | Schedula(`events`,`personal_events`,Google) | 経由 read/write |
| AI実行実績/roadmap/goal_eval | Memoria(`agent_runs`,roadmap,`goal_eval_logs`) | read のみ |
| 個人プロファイル | Cernere | 保持しない |
| **計画/スプリント/velocity/リスケ履歴/priority** | **Calliope** | **自DB** |

## 3. データモデル (Calliope 自DB = 計画成果物のみ)

| テーブル | 主フィールド |
|---|---|
| `plan` | 対象期間, 生成元goal参照, 状態(draft/active/superseded), velocityスナップ |
| `plan_entry` | plan_id, task参照, 割当時間枠(start/end), 予定リンク(schedula event id), lane, 順序, 確信度 |
| `sprint` | 期間, 対象PJ/goal, 目標velocity, gompertz収束スナップ, 状態 |
| `sprint_task` | sprint_id, task参照, 状態履歴 |
| `velocity` | PJ/カテゴリ, 期間, 補正係数k_p, スループットΘ_p, 分布, sample_size, 出典 |
| `task_estimate` | task参照, E_t, estimate_source(human/analogy/llm), confidence |
| `reschedule_log` | トリガ, before/after, 適用者(human/auto), 理由 |
| `priority` | PJ/goal/task, roadmap importance + override → 解決値 |
| `curve_snapshot` | sprint参照, date, gompertz params, inflow λ, burndown |
| `connector_state` | サービス種別, health, last_sync, cursor |
| `calendar_link` | Googleカレンダー連携設定(Schedula経由), 同期方向, calendar_ref(`'primary'` or Schedula 参照 id。**生カレンダーID = email になりうる値は保存しない**) |
| `confirmation` | 高リスク操作の裁定待ちキュー(kind, payload, status, decided_by/at)→ [pm-extensions.md F1] |

個人データ(name/email)は持たない。破壊更新なし(supersede で版管理)。
task/goal 参照は正規文字列形 **`actio:<taskId>` / `actio-pm:<projectId>/<externalId>`** に全テーブルで統一(JSON 参照は使わない)。

## 4. コネクタ

- 認証: 上流ごとに service token(Bearer)を env から。`src/clients/<svc>.ts` の `make<Svc>Client` factory。
- 破壊操作は Cernere session / WebSocket 経由(LUDIARS 規約)。

| コネクタ | read | write |
|---|---|---|
| ActioConnector | tasks / pm_tasks / pm_analytics(gompertz,critical-path) | task schedule 割当 / priority リスケ提案 |
| SchedulaConnector | events / personal_events / freeBusy(Google合成) | 計画ブロック予定化 / scheduling |
| MemoriaConnector | agent_runs / roadmap / goal_eval | read-only |

外部PM(GitHub/Linear/Notion)は**保留**(Memoria タスク #1)。暫定方向は Actio PM 単一窓口。

## 5. 能力設計(要約)

- **A. AI速度加味スケジュール**: 過去実績で補正した velocity(`k_p=median(実所要/見積り)`)で所要予測、
  critical-path 依存順 × 優先度リスト法で C レーン(並列AI容量)に暦日配置。人間ゲートのみ Schedula 空きへ。→ [scheduling.md §2,§4]
- **B. 他PJ優先度リスケ**: roadmap importance + goal + task + 締切で合成優先度、変化トリガで再計画・diff・
  リスク判定・適用。クロスPJ調停 + starvation ガード(aging)。→ [scheduling.md §3,§5]
- **C. スプリント自動管理**: 容量から Gompertz バグ収束予約 + タスク流入予約を控除しスコープ確定、
  日次で曲線再フィット・逸脱時に再設計提案。→ [scheduling.md §6]
- **D. Googleカレンダー**: Schedula 経由(Schedula を双方向化=別PR)。freeBusy で空き把握 / 計画を可視化。
  計画由来イベントはタグでループ防止。→ [calendar-memoria.md D]
- **E. Memoria引継ぎ**: 移管せず Actio(task/goal正本)+Memoria(roadmap/goal_eval)を read でバインド。
  共有API隙間3点(kind/category/creator_type)を埋める。→ [calendar-memoria.md E]

## 6. 自律性モデル

提案 → 適用の2段。低リスク=auto-apply+事後通知 / 高リスク=`409 human_confirmation_required`(Thaleia パターン)。
409 は `confirmation_id` を返して裁定待ちレコードを永続化し、承認キュー(`GET /api/confirmations` /
`POST /api/confirmations/:id` approve/reject)で人間が裁定する(P3。→ [pm-extensions.md F1])。
全 apply は履歴化、破壊更新なし。

## 7. API(抜粋)

`POST /api/plan/generate` `POST /api/plan/:id/apply` `GET /api/plan` /
`POST /api/reschedule/trigger` `GET /api/reschedule/log` /
`GET/POST /api/sprint` `POST /api/sprint/:id/replan` / `GET /api/velocity` /
`GET /api/confirmations` `POST /api/confirmations/:id` /
`POST /api/calendar/sync` / `GET /health`。破壊操作は Cernere session/WS。

**認証**: `/api/*` は service token(Bearer, env `CALLIOPE_SERVICE_TOKEN`)。token 設定時は全 `/api/*` で必須、
未設定時は開発モード(起動時に警告ログ)。`/health` は常に公開。

## 8. 技術スタック

Hono + TS(ESM/NodeNext) + tsx / Drizzle + better-sqlite3(自DB) / vitest。
構造規約=Thaleia 準拠、永続化=Actio 流。上流は `fetch`+Bearer。

## 9. 前提

1. **確定**: 単独サービス + 独自リポ `Calliope`。
2. **保留**: 外部PM/資料群の結合方式(Memoria タスク #1)。P0-P5 は非依存。
3. Google Calendar は Schedula 経由(Schedula 双方向化は別 PR)。
4. 自律性 = 低リスク auto / 高リスク確認。
5. UX は Thaleia、Calliope は純統括。
6. velocity は**過去実装実績で補正**(neco 指示)。
7. 見積り欠損は Calliope EstimationService(analogy→LLM)で補完(既定)。
8. 並列容量 C は当面 env `CALLIOPE_AGENT_LANES`、将来 Concordia 実データ。

## 10. 実装フェーズ(Codex 委託 / full-set)

| Phase | 内容 |
|---|---|
| **P0** | リポ scaffold + config/health + 自DB migration + Connector 基盤(Actio/Schedula/Memoria read) |
| **P1** | velocity + EstimationService + priority + 能力A スケジューラ + plan |
| **P2** | 能力C スプリント設計/管理 + gompertz/inflow 取込 |
| **P3** | 能力B トリガ/リスケ/クロスPJ調停 + 自律性適用 |
| **P4** | 能力D Googleカレンダー双方向(Schedula 拡張含む) |
| **P5** | フロント/UI(計画・スプリント・velocity 閲覧/調整) |
| **P6(保留)** | 外部PM Linear + 資料群バインド(結合方式決定後) |

各 Phase は full-set-implementation 準拠(MVP で削らず配線・テストまで完結)。P0 詳細は [`docs/CODEX-P0.md`](docs/CODEX-P0.md)。
PM運用拡張(F1-F7)の Phase 割当は [`docs/design/pm-extensions.md`](docs/design/pm-extensions.md) の採用推奨順を参照
(F5→P1a 同梱 / F4→P2 / F1・F3→P3 / F2→P3.5 / F7→P5 / F6→保留)。
