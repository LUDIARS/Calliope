---
task: 02-task-autogen
project: Calliope
kind: 実装
created: 2026-07-16T00:00:00.000Z
memory_links:
  - docs/design/task-lifecycle.md
  - docs/design/pm-extensions.md
---
# タスク自動生成 (generate) — 候補検出 + Decision Inbox 経由の Actio 起票

## 目的

docs/design/task-lifecycle.md §G2 の実装。計画成果物 (sprint carryover / risk red /
plan gap / retrospective) から「Actio にあるべきなのに無いタスク」を検出し、
confirmation (`kind: task_create`) として提案、approve 時に Actio へ起票する。

前提: 2026-07-16-01-actio-write-client (createTask) がマージ済みであること。
未マージなら本タスクは着手せず pending のまま報告する。

## 完了条件

- 生成ソース 4 系統 (design §G2) を純粋関数 (`src/taskgen/engine.ts` 等、I/O なし) で実装し、
  各系統に fixture テストがある。
- dedup: 既存 Actio タスクとの task_ref / 正規化タイトル一致、および pending/rejected な
  同一候補 confirmation がある場合は候補から除外される (テストで担保)。
- 候補は自動では起票されない。confirmation (`kind: task_create`) に payload
  (候補リスト: タイトル・project scope・生成根拠。task id 参照のみ、個人データなし) で積まれ、
  approve で createTask 実行 + 結果 (actio task id) を payload に追記、reject は理由必須。
- `POST /api/tasks/generate` (on-demand) を追加。日次 orchestration (07:30 JST) に組み込み、
  daily briefing に「タスク生成候補 n 件 (要裁定)」が載る。
- SRP / レイヤ分離 (clients / feature 純粋ロジック / routes / db) を維持。
- `npm run typecheck` / `npm test` green。

## 実装メモ (2026-08-04)

- 検出エンジンは `src/taskgen/engine.ts` (純関数)。 dedup は `dedupeCandidates` に集約し、
  除外分は `suppressed` (理由付き) として報告する (無言 fallback 回避)。
- 再提案抑止は候補 `key` を pending / rejected の `task_create` confirmation payload から
  逆引きして行う。 `external_id` は key から決定的に導出するため Actio 側でも冪等。
- `POST /api/tasks/generate` のみ追加 (候補一覧は既存 `GET /api/confirmations?status=pending`)。
- 日次 orchestration は `makeDailyLoop` の `generate` ステップ (reschedule → generate → briefing)。
  briefing は `taskGeneration` 節 + `summary.taskGenerationCandidates` を持つ。
- タイトル正規化は §G3 と共有するため `src/tasks/title.ts` へ切り出した。
- 仕様は `spec/feature/task-generation.md` (機能) と
  `spec/interface/task-generation-api.md` (HTTP 境界) が正本。
  ドメイン帰属は `.anatomia/domains/*.domain.json` (JSON。Anatomia は YAML を読まない)。

## スコープ (編集可ディレクトリ)

- src/taskgen/ (新設)
- src/routes/
- src/orchestration/
- src/briefing/
- src/db/ (confirmation kind 追加が必要な範囲)
