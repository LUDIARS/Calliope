# タスク自動生成 (task generation)

Calliope が自分の計画成果物から「Actio にあるべきなのに無いタスク」を検出し、
**Decision Inbox (confirmation) 経由でだけ** Actio へ起票する機能。
設計正本は `docs/design/task-lifecycle.md` §G2。

Calliope はタスクの正本を持たない。この機能も候補 (提案) までを自分で作り、
実体の作成は承認後に Actio の write API を呼ぶだけに留める。

## 目的

- 閉じたスプリント・赤いゴール・孤児化した plan entry・週次振り返りの指摘が、
  誰も起票しないまま消えるのを防ぐ。
- 自動起票はしない。裁定 (approve / reject) を人間に残し、
  提案理由と抑止理由の両方を残す。

## 候補検出 4 系統

検出は `src/taskgen/engine.ts` の純粋関数で行う (I/O なし、fixture でテスト可能)。

| source | 入力 | 候補になる条件 | 候補タイトル |
|---|---|---|---|
| `sprint_carryover` | 自DB の sprint / sprint_task | `status=closed` のスプリントに `committed` のまま残った `task_ref` | `Restore carryover task <task_ref>` |
| `risk_red` | 自DB の goal_risk_snapshot | goal_ref ごとの**最新日付**スナップショットが `red` | `Risk mitigation for <goal_ref>` |
| `plan_gap` | 自DB の active plan の entry | entry が参照する `task_ref` (孤児判定は dedup 層が行う) | `Restore planned task <task_ref>` |
| `retrospective_action` | 週次振り返り (F7) の recommendations | 指摘コードごとに 1 件 | `Retrospective action: <code>` |

各候補が持つのは id 参照と閾値事実だけで、上流の本文・個人データは持ち込まない。

- `key`: `<source>|<discriminator>` の安定キー。再提案抑止の突合に使う。
- `externalId`: `key` から決定的に導出する (`calliope-taskgen-<slug>`)。
  Actio 側の `external_id` になるため、再実行しても起票は冪等になる。
- `dueAt`: `risk_red` の deadline のみ。**オフセット付き ISO 8601 instant** だけを通し、
  それ以外は `null` に落とす (Actio の契約が offset 必須)。
- `category`: `projecthub:<id>` は不透明参照なので載せない (`null`)。

## dedup と再提案抑止

`dedupeCandidates` が単一の抑止点。除外した候補は捨てずに `suppressed`
(理由付き) として報告する — 無言フォールバック禁止の適用。判定順は次のとおり。

1. `existing_task_ref` — 候補の `originTaskRef` が Actio に既存 → 起票不要 (孤児ではない)。
2. `open_confirmation` — 同じ `key` が **pending / rejected** の `task_create`
   confirmation に既にある → 再提案しない。
3. `duplicate_candidate` — 同一 run 内で `key` が衝突 (先勝ち)。
4. `existing_title` — 正規化タイトルが既存タスクと一致。
5. `duplicate_candidate` — 同一 run 内で正規化タイトルが衝突 (先勝ち)。

タイトル正規化 (`src/tasks/title.ts` の `normalizeTitle`: 小文字化 + NFKC +
記号/空白畳み込み) は棚卸し §G3 と共有する単一実装。

## Decision Inbox (task_create confirmation)

候補が 1 件以上あるときだけ `kind: task_create` の confirmation を 1 件作る
(候補 0 件なら confirmation を作らない)。

- payload: `{ generatedAt, summary, candidates }`。契約は
  `src/taskgen/payload.ts` の Zod スキーマが正本で、service / routes / briefing が共有する。
- TTL は 24 時間。期限切れは `expired` になり、決裁は 409 で拒否する
  (reschedule のような自動再提案はしない)。
- **approve**: 候補を Actio へ `createTask` し、結果 (actio task id / task_ref) を
  confirmation へ追記する。
- **reject**: 理由必須。`key` は抑止側に回り、同じ候補は再提案されない。
- 候補一覧の read API は増やさない。既存の
  `GET /api/confirmations?status=pending` に載る。

## 実行タイミング

- **日次 07:30 JST**: `makeDailyLoop` の `generate` ステップ
  (順序は reschedule → generate → briefing)。生成が失敗しても
  `generate_failed:<name>` を warnings に積み、briefing は続行する。
- **on-demand**: `POST /api/tasks/generate`。
- `CALLIOPE_TASK_GENERATE=off` で日次ステップを無効化する。
- Actio 未設定のときは mock に落とさず、日次では
  `{ status: 'skipped', warning: 'actio_unconfigured' }` を返し、API では 503 にする。

日次ブリーフィングには `taskGeneration` 節と
`summary.taskGenerationCandidates` (= 「タスク生成候補 n 件 (要裁定)」) が載る。
値は生きている confirmation の `payload.summary` だけから作り、
新たな上流呼び出しはしない。

## 保持しないもの

- タスク・目標の本文、担当者、氏名、email、token は Calliope DB に保存しない。
- confirmation payload が持つのは `task_ref` / `goal_ref` / `project_ref` 参照、
  提案タイトル、生成根拠 (閾値事実の短文)、および承認後の actio task id だけ。
- 詳細は `spec/data-schema.md` の `confirmation` 行に従う。

## 制約・既知の制限

- 候補は自動起票されない。承認が無い限り Actio には何も書かれない。
- `plan_gap` は active plan が 1 件も無ければ候補を出さない。
- `risk_red` は goal_ref ごとに最新スナップショットのみを見るため、
  過去に赤だったが現在 amber/green のゴールは候補にならない。
- 赤が続く間の再提案は dedup 層 (既存タスク / pending・rejected confirmation) が抑止する。

## 関連

- インターフェース: `spec/interface/task-generation-api.md`
- データ: `spec/data-schema.md`
- ドメイン境界: `spec/architecture-domains.md`
- 設計: `docs/design/task-lifecycle.md` §G2
- 実装タスク: `spec/tasks/2026-07-16-02-task-autogen.md`
