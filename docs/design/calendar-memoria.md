# Calliope 詳細設計 v0.2 — D(Googleカレンダー連動) / E(Memoria目標・タスク引継ぎ)

親設計: [`../../DESIGN.md`](../../DESIGN.md)(設計書 v0.2)§5 D/E。本書はその2能力を詳細化する。
作成: 2026-07-09 / 設計: Claude(Opus) / 実装委託: Codex
改訂: 2026-07-09 仕様レビュー反映([`../reviews/2026-07-09-spec-review.md`](../reviews/2026-07-09-spec-review.md) A-2/A-3/B-6/C-1)

---

## 能力D — Googleカレンダー個人予定連動

### D.0 原則
**Google Calendar の所有権は Schedula に残す。Calliope は Google を直接叩かず、必ず Schedula 経由。** 予定/カレンダーの正本は Schedula というサービス境界を崩さない。Calliope は「計画ブロックを予定化したい」「人間の空きを知りたい」という要求を Schedula に投げるだけ。

### D.1 現状(調査結果)と不足
| 項目 | 現状(Schedula `modules/calendar/routes.ts`) | 不足 |
|---|---|---|
| OAuth | refresh_token による token リフレッシュのみ | **認可(consent→code交換)フローが無い** |
| イベント read | `GET /events`, `/calendars`, `/status` | ― |
| イベント write | **無し** | **create/update/delete(write-back)が無い** |
| 同期方向 | Google→アプリ read-only | **双方向が無い** |
| lib | 素の `fetch`(googleapis 不使用) | ― |
| token 保管 | user legacy 列(Cernere 移管済) | ― |

### D.2 Schedula 側に追加する機能(別タスク, 本書で設計)
Calliope の前提として Schedula calendar を拡張する。**この拡張は Schedula リポの別 PR** だが、Calliope 設計として要件をここで確定:
1. **OAuth consent フロー**: authorization code grant。`GET /api/calendar/oauth/start`(consent URL 発行) → `GET /api/calendar/oauth/callback`(code→token 交換, refresh_token を Cernere 経由保管)。
2. **イベント write-back**: `POST/PATCH/DELETE /api/calendar/events`(Google `calendar/v3/events` insert/patch/delete)。
3. **双方向同期**: 
   - pull: Google → Schedula `personal_events` ミラー。増分は Google `syncToken`(nextSyncToken)で。
   - push: Calliope 計画ブロック → Google イベント。
4. **freeBusy 集約**: `GET /api/calendar/freebusy?range=` = personal_events + Google busy を合成して返す(Calliope A §4.3 が消費)。

### D.3 Calliope 側の利用
- **read(空き把握)**: `SchedulaConnector.freeBusy(range)` → 人間(neco)の予定で埋まっている時間帯を取得 → スケジューラ(A §4.2)の**人間ゲート配置制約**に使う。AI レーンは影響を受けず、人間の承認/レビューだけがカレンダー空きに従う。
- **write(計画の可視化)**: 確定した計画ブロック・締切・人間ゲートを Schedula 経由で Google に書き、neco のカレンダー上に「AIが今どの PJ を進めているか / いつ判断が要るか」を表示。
- **保持しないもの**: Google トークンは Schedula/Cernere が保持。Calliope は `calendar_link`(`calendar_ref`・同期方向・有効/無効)だけを持つ。
  **`calendar_ref` は `'primary'` エイリアス、または Schedula が発行する不透明な参照 id。Google の生カレンダー ID は保存しない**
  (primary カレンダーの ID はユーザの email そのものであり、個人データ非保持規約 [[project_personal_data_rule]] に抵触するため)。

### D.4 ループ防止(重要)
- Calliope が作った計画由来イベントには `extendedProperties.private.calliope = <plan_entry_id>` を付与。
- pull 同期時にこのタグ付きイベントは「外部予定」として再取り込みしない(二重計上防止)。
- 逆に neco が手で入れた予定・外部由来イベントのみを「人間の占有」として freeBusy に反映。
- **supersede 時の後始末**: 新 plan の apply 時に旧 active plan と diff を取り、削除/移動された entry の
  Google イベントは Schedula 経由で update/delete する(`plan_entry.schedula_event_id` + calliope タグで自イベントを特定)。
  旧計画ブロックをカレンダーに残さない。plan 自体は supersede 版管理のまま(履歴は自DB に残る)。

### D.5 同期方向のセマンティクス(SoT境界)
| 種別 | SoT | 流れ |
|---|---|---|
| neco の個人予定(会議・私用) | Google | Google → Schedula → Calliope(read, 占有制約) |
| 計画ブロック/人間ゲート/締切 | Calliope | Calliope → Schedula → Google(write, 可視化) |

### D.6 自律性 / エッジ
- **Google への write は既定「高リスク」→ 確認**(v0.1 §6)。ただし「自分の計画ブロックの可視化のみ」は設定で auto 可。
- consent 失効/未接続 → **degrade**: カレンダー無しモードでスケジュール続行(人間ゲートは「未定枠」として提示)し警告。
- token リフレッシュ失敗は Schedula 側で処理、Calliope は `connector_state` に health を記録。

### D.7 Codex フェーズ
- **P4a(Schedula)**: calendar モジュールに OAuth consent + write-back + freeBusy 集約 + syncToken 増分。別リポ PR。
- **P4b(Calliope)**: SchedulaConnector.freeBusy/createEvent 結線 + `calendar_link` + ループ防止タグ + degrade。P1c の近似 freeBusy(scheduling.md §4.3)を Schedula 版へ差し替え。

---

## 能力E — Memoria の目標・タスクモジュールを引き継ぐ

### E.0 「引き継ぐ」の解釈
**データ移管(migration)ではなく、SoT からの consume + 共有 API の隙間埋め**。
- タスク/目標の正本は今後 **Actio**(既に kind/creatorType/category 移植済、`DESIGN-memoria-task-port.md`「Actio をタスクの唯一の本拠地に」)。
- Memoria は個人ライフログ + roadmap 集約 + goal 日次評価を持ち続ける。
- Calliope は「目標に紐づく PM/計画知能」を担い、goal/task は Actio から、roadmap/goal_eval/velocity は Memoria から**読む**。物理移管はしない(疎結合)。

### E.1 現状のデータ所在(再掲・確定)
| データ | 所在 | Calliope の参照 |
|---|---|---|
| task/goal スキーマ | Actio `tasks`(kind/creatorType/category 移植済) | ActioConnector read(正本) |
| Memoria→Actio 共有 | `shareTaskToActio` が title/details/status/due_at のみ送信 | **要拡張(E.2)** |
| goal_eval_logs(日次評価) | Memoria `goal_eval_logs` + eval-scheduler(毎朝7時) | MemoriaConnector read |
| roadmap(事業ライン優先度) | Memoria `roadmap/aggregate.ts`(roadmap-* JSON集約) | MemoriaConnector read(§3 優先度) |
| agent_runs(velocity元) | Memoria `agent_runs` | MemoriaConnector read(§2 velocity) |

### E.2 隙間埋め①: 共有 API の欠損補完
現状 `shareTaskToActio` は **kind / category / creator_type を送っていない**。Actio を faithful な SoT にするため:
- Memoria 側 `shareTaskToActio` に `kind` / `category` / `creator_type` を追加送信。
- Actio 側 share 受け口が該当フィールドを受理・保存。
- 効果: goal(kind=goal) と PJ カテゴリが Actio に流れ、Calliope が「目標」と「所属PJ」を Actio 単一ソースで読める。
- **小修正(Actio + Memoria の各 PR)**。破壊なし・追記のみ。

### E.3 隙間埋め②: goal_eval の活用
- Memoria の日次目標評価(todo/doing/done スナップショット)を Calliope が read。
- 用途: 目標の**達成進捗**を優先度(§3 urgency)とスプリント健全性(§6)に反映。「目標が予定より遅れている」→ その goal 配下タスクの P(t) を引き上げ。
- Calliope 側で Actio task 完了から進捗を独自算出も可能だが、既存の goal_eval を一次信号として使う(二重実装回避 = MUSA 原則)。

### E.4 隙間埋め③: roadmap 優先度の取り込み
- 一次: Memoria `GET /api/roadmaps`(aggregate 済 line/member importance)を read。集約ロジックを二重実装しない。
- 代替(fallback): Calliope が roadmap-* リポの JSON を直読(Memoria 停止時の縮退)。
- → §3 Priority モデルの「プロジェクト/事業ライン層」入力。

### E.5 目標駆動スケジュールとの接続
- **goal → タスク → 計画** の連鎖: Actio の goal(kind=goal)を起点に、配下タスク(category/goal 紐付け)を集め、A(§4)でスケジュール、C(§6)でスプリント化。
- goal と task の構造的親子リンクは Memoria/Actio ともに弱い(category 文字列で緩く紐付く)。Calliope は **category + goal 参照**で goal↔task を解決するマッピング層を持つ(`plan.goal_ref`)。厳密な親子が要るなら Actio 側にリンクを足す(将来)。

### E.6 自律性 / エッジ
- Memoria は read-only(Calliope から書かない)。書き込みは Actio(task) / Schedula(event) のみ。
- Memoria 未接続 → roadmap は fallback 直読、goal_eval 無しで進捗は Actio 完了から近似(警告)。
- 個人データ規約: Calliope は name/email を持たず、task/goal/goal_eval は id 参照 + 非個人フィールドのみ read。

### E.7 Codex フェーズ
- **P0 内**: MemoriaConnector(read: agent_runs/roadmap/goal_eval), ActioConnector(read: tasks/goals) を Connector 基盤として実装。
- **別 PR(Actio+Memoria)**: `shareTaskToActio` の kind/category/creator_type 拡張(E.2)。
- **P1b**: roadmap → Priority モデル結線(E.4)。
- **P2/P3**: goal_eval → sprint 健全性 / priority urgency 反映(E.3)。

---

## まとめ: D/E の位置づけ

- **D** は「Schedula を拡張して Google 双方向化 → Calliope はそれを freeBusy/イベント化で使う」。Google 所有権は Schedula に据え置き。
- **E** は「移管せず、Actio(task/goal 正本) + Memoria(roadmap/goal_eval/velocity) を read でバインド + 共有 API の隙間3点を埋める」。
- 両能力とも **MUSA 原則「エンジン二重実装せずバインド」** を厳守。Calliope は薄い統括層に留まる。
