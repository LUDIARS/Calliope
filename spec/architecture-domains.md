# Calliope アーキテクチャドメイン

Calliope は「エンジンを二重実装しない」統括層であり、コードは上流取得 / 計画ロジック /
HTTP / 永続化 / 定期実行 / 共有ランタイムのドメインに分かれる。
本書はその境界の読み物で、**membership 定義の正本は `spec/domains/<domain>.domain.json`**。
片方だけを更新しない。

**正本は `spec/domains/` に置く。** Anatomia の ontology ローダ
(`resolveCommittedOntologyDir`) は `spec/domains` → `spec/data/ontology` →
`.anatomia/domains` の順に探し、最初に見つかったディレクトリだけを読む。
`.anatomia/` はローカル状態として `.gitignore` 済みで、Revisor のレビュー worktree に
存在する保証が無い。仕様の隣に置くため正本は `spec/domains/` に移した
(`.anatomia/domains/` は旧世代の互換 fallback であり、`spec/domains/` があるとき一切読まれない)。

**membership 定義は JSON で書く。** ローダは `.json` / `.mjs` / `.js` しか読まず、YAML は
無視する。YAML で書くと「ドメインを定義したのに解析上は 0 ドメイン」になり、変更関数が
全て unassigned となって対象ドメイン欠如でマージがブロックされる。
形式は `{ name, description, presetRules: [], templateRules: [], membership: [{ pathPattern }], specRefs? }`
で、`pathPattern` は JS RegExp source (パスは `/` 区切りに正規化されたうえで照合される)。

## ドメイン一覧

| ドメイン | 責務 | 保持するもの | 所有パス |
|---|---|---|---|
| `external-clients` | 上流 (Actio / Schedula / Memoria / Excubitor / ProjectHub) への HTTP | 何も保持しない | `src/clients/` |
| `http-api` | ルーティング・認証・CORS・エラー写像 | 何も保持しない | `src/routes/` |
| `web-ui` | ブラウザ側の画面 | 何も保持しない | `src/ui/` |
| `sprint-planning` | 見積り・優先順位・リスケ・スプリント・棚卸し (§G3) の算出 | 何も保持しない | `src/planning/` `src/estimation/` `src/priority/` `src/reschedule/` `src/sprint/` `src/stocktake/` |
| `task-generation` | タスク候補の検出 (§G2) と Decision Inbox 経由の Actio 起票 | 何も保持しない | `src/taskgen/` |
| `progress-metrics` | velocity・burndown・リスク・振り返り集計 | 何も保持しない | `src/velocity/` `src/risk/` `src/retrospective/` |
| `schedule-calendar` | カレンダー連携とスケジューラ | 何も保持しない | `src/calendar/` `src/scheduler/` |
| `service-map` | サービスマップ (task_ref / project_ref の語彙、稼働実体の可視化) | 何も保持しない | `src/refs.ts` `src/servicemap/` |
| `orchestration` | 日次 07:30 JST・週次 08:00 JST のタイマーと横断的な取りまとめ | タイマーハンドル | `src/orchestration/` `src/briefing/` |
| `persistence` | 自DB (計画成果物のみ) | plan / sprint / velocity / priority / confirmation 等 | `src/db/` |
| `service-runtime` | プロセスとしての Calliope。起動・設定・共有ユーティリティ・テスト土台 | 何も保持しない | `src/index.ts` `src/app.ts` `src/config.ts` `src/tasks/` `src/__tests__/` |

## 境界ルール

- **純粋関数に I/O を持ち込まない。** 算出関数 (calc / score / listSchedule / freebusy /
  compose* / detect*) は fixture だけでテストでき、client も repository も import しない。
  上流呼び出しは同フォルダの `engine.ts` / `service.ts` に閉じる。
- **`http-api` から DB を直接触らない。** 必ず `persistence` の repository 経由。
- **`service-runtime` の共有ユーティリティは他ドメインへ依存しない。** ここに循環を作らない。
  タイトル正規化 (`src/tasks/title.ts`) を `sprint-planning` と `task-generation` が
  共有するのはこのためで、片方の所有物にすると依存が逆流する。
- **正本の実体を持ち込まない。** task / event / goal / roadmap の実体は上流にあり、
  Calliope が保持するのは id 参照と計画成果物だけ (spec/data-schema.md)。

## 帰属の維持

- `src/` 直下に新しい feature フォルダを作ったら、同じ PR で `spec/domains/` の
  既存ドメインへ `membership.pathPattern` を追記するか、新しい
  `spec/domains/<name>.domain.json` を足す。既定の受け皿ドメインは置かない
  (暗黙の帰属は無言フォールバックと同じ扱いにする)。
- テストは各 feature フォルダ直下 `__tests__/` にコロケーションする。
  `membership` の `pathPattern` は `(?:.*/)?[^/]+$` でフォルダ配下を拾うため、
  コロケーションしたテストは実装と同じドメインに帰属する。
- ドメインは重複所有しない。追加時は既存 `pathPattern` と交差しないことを確認する。
