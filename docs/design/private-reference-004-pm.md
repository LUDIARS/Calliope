# Calliope 詳細設計 — <private-reference-004> Hub PM 連携(プロジェクト進捗 / スプリント管理)

親設計: [`../../DESIGN.md`](../../DESIGN.md) §4/§5。位置づけ: 2026-07-16 neco 指示
「<private-reference-003> と連動して PM 的ポジからプロジェクトの進捗を管理する。プロジェクトのスプリントも管理する」
の設計正本。Calliope を <private-reference-004>(<private-reference-012> Game Academy ゲーム制作ラボの運営 hub、Corpus 派生)の
**学生ゲーム制作プロジェクトの PM 秘書**として接続する。

## 全体像(責務分割 — bind, don't reimplement)

```
<private-reference-004> Hub (Corpus)                     Calliope                        タスク正本
┌──────────────────┐   read  ┌──────────────────────┐   read   ┌──────────────┐
│ projects プラグイン │ ◄────── │ <private-reference-004>Connector         │ ───────► │ (H1 で裁定:    │
│  = PJ レジストリ正本 │         │ 進捗集計 / sprint 設計 │          │  Actio school │
│ progress パネル     │ ──────► │ (既存 sprint エンジン)  │          │  scope 等)    │
└──────────────────┘  Calliope └──────────────────────┘          └──────────────┘
                       API read
```

- **プロジェクトレジストリの正本 = <private-reference-004>**(学生 PJ の名簿・メンバー・リポ参照)。
  <private-reference-004> に `projects` プラグインを新設する(<private-reference-004> 側タスク)。
- **計画・スプリント・進捗判定のエンジン = Calliope**(既存 A/B/C 能力の適用)。
  <private-reference-004> 側にスプリントエンジンを二重実装しない。
- **表示面 = <private-reference-004> Hub パネル**。<private-reference-004> が Calliope API を read して進捗/burndown を表示する
  (Aedilis の `HttpServiceConnector` と同じ接続パターン)。Calliope UI は運営者向け、
  <private-reference-004> パネルは学生向け。

## H1. 未確定の設計裁定(設計相談 — 実装前に解決する)

学生 PJ のタスク正本と進捗ソースは既存 LUDIARS 構成と前提が異なるため、先に裁定する:

1. **タスク正本の置き場** — 候補: (a) Actio 本体の project scope、(b) Actio-SchoolModules、
   (c) <private-reference-004> 自前(SQLite)。MUSA 原則からは (a)/(b) が本線(Calliope が task 正本を持たない・
   <private-reference-004> にタスクエンジンを作らない)。学生の認証は Cernere 前提(<private-reference-004> は Cernere `user_id` 参照)。
2. **velocity ソース** — Calliope の velocity は Memoria agent_runs(AI 実績)基準。学生 PJ は
   人間作業なので同じ補正は使えない。学生 PJ 用の velocity source
   (タスク完了実績のみ / 見積り申告)を sprint エンジンにどう注入するか。
3. **自律性の適用範囲** — 学生 PJ に対する Calliope の書込(タスク生成・リスケ)は
   運営者裁定(Decision Inbox)のみとするか、PJ リーダー承認を挟むか。

→ `<private-reference-004>/spec/tasks/2026-07-16-01-pm-task-source.md`(設計相談)。裁定は neco。

**最終裁定 (2026-07-17, neco — 並行裁定の競合解決済み)**:
(1) タスク正本 = **Actio コア `tasks` に `project_id` を新設** (group 代用しない)。値は
<private-reference-004> `<private-reference-004>_project.id` の不透明参照で、PJ レジストリ正本は <private-reference-004> のまま・Actio 側に project
マスタは作らない。Calliope の `<private-reference-004>:<project_id>` scope と一致。学生の操作は <private-reference-004> フロント
簡易 UI で完結 (Actio UI は触らせない)。→ 派生: `Actio/spec/tasks/2026-07-17-01-<private-reference-004>-project-tasks.md`。
(2) velocity = **申告 + 補完** (E_t = 学生申告 `estimated_minutes`、欠損は EstimationService
補完。velocity = 完了実績 Θ_p 週次 rolling、k_p 非適用 = k=1 + 広信頼帯 + 暫定表示。
cold-start は申告合計容量。実所要の自己申告は導入せず自動計算のみ)。
(3) 自律性 = **auto-apply 全面禁止**。承認ゲートは**リスケ適用 + PJ スコープ判断のみ**、承認者は
**プロデューサー (PJ 単位ロール) + 総合ディレクター (hub 全体ロール) のみ**。**学生の裁量あり**
(自 PJ のタスク作成・編集・完了は <private-reference-004> 簡易 UI で自由)。承認経路は <private-reference-004> Web hub 限定
(Cernere PASETO、Discord 承認不可)。依存関係/milestone は必要時に再設計相談
(Actio スケジュール統合予定の文脈で)。全経緯は <private-reference-004> タスク md「最終裁定」節と
<private-reference-004> `spec/faq/<private-reference-004>-pm-task-source.md` (PR #13) を参照。

## H2. <private-reference-004> 側 — projects プラグイン(レジストリ正本)

- `plugins/projects/` 新設(CorpusModule 規約: `index.ts` + `panel.ts`、schema は
  `plugins/data.ts` に集約、pack.json / build:panels 登録)。
- データ: `<private-reference-004>_project`(id, name, description, status[active/paused/closed],
  repo_url?, created_at)+ `<private-reference-004>_project_member`(project_id, user_id=Cernere 参照,
  role[leader/member])。名前・学科等の個人属性は持たない(Cernere `<private-reference-012>_user` が単一情報源)。
- パネル: PJ 一覧 / 登録・編集 / メンバー割当。read API(`/api/<private-reference-004>/projects`)を
  外部サービス(= Calliope)向けに公開する(service token)。

## H3. Calliope 側 — <private-reference-004>Connector + プロジェクトバインド

- `src/clients/<private-reference-004>.ts` — `make<private-reference-004>Client`(factory 規約): `listProjects` / `getProject` /
  `listMembers` / `health`。read-only。503 `<private-reference-004>_unconfigured` 規約に従う。
- バインド: <private-reference-004> project を Calliope の project scope(`<private-reference-004>:<project_id>`)として扱い、
  優先度解決・plan・sprint・risk の既存テーブルにそのまま載せる(スキーマ拡張は scope 前置のみ)。
- タスク取得は H1 の裁定に従う(裁定確定までこのタスクは着手しない)。

## H4. Calliope 側 — 学生 PJ スプリント管理 + 進捗レポート

- sprint 設計/replan/close(能力C)を `<private-reference-004>:*` scope に適用。velocity source は H1-2 の裁定値。
  Gompertz バグ収束予約は学生 PJ では初期データが無いため、流入予約のみの縮退モードを許す
  (縮退は明示ログ + レポート表記。無言フォールバック禁止)。
- 進捗レポート: `GET /api/<private-reference-004>/progress`(PJ 別の sprint health / burndown / risk /
  停滞タスクを on-demand 合成、保存しない)。週次で Nuntius `calliope.<private-reference-004>.weekly` に配信
  (運営者向け)。
- 書込系(タスク生成・リスケ適用)は H1-3 の裁定に従い、既定は confirmation 経由のみ。

## H5. <private-reference-004> 側 — progress パネル(表示面)

- `plugins/progress/`(または projects パネル内タブ): Calliope `GET /api/<private-reference-004>/progress` を
  `HttpServiceConnector` で read して PJ ごとの進捗/burndown/リスクを表示。
  Calliope 未稼働時は degraded 表示(<private-reference-004> の他機能と同じ扱い)。

## 実装順と依存

| 順 | 内容 | 置き場 | 依存 |
|---|---|---|---|
| 1 | H1 設計相談(タスク正本・velocity・自律性) | <private-reference-004>/spec/tasks/…-01-pm-task-source.md | — |
| 2 | H2 projects プラグイン | <private-reference-004>/spec/tasks/…-02-projects-plugin.md | H1 |
| 3 | H3 <private-reference-004>Connector + バインド | Calliope/spec/tasks/…-04-<private-reference-004>-client.md | H2 |
| 4 | H4 sprint 管理 + 進捗レポート | Calliope/spec/tasks/…-05-<private-reference-004>-sprint-progress.md | H3 |
| 5 | H5 progress パネル | <private-reference-004>/spec/tasks/…-03-progress-panel.md | H4 |
