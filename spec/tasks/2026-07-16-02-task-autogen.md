---
task: 02-task-autogen
project: Calliope
kind: 実装
status: pending
created: 2026-07-16T00:00:00.000Z
source_session: lictor-9747bcfe-3969-4e12-959d-6cf39d3287fc
memoria_task_id: 530
actio_task_id: null
memory_links:
  - E:/Document/Ars/Calliope/docs/design/task-lifecycle.md
  - E:/Document/Ars/Calliope/docs/design/pm-extensions.md
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

## スコープ (編集可ディレクトリ)

- src/taskgen/ (新設)
- src/routes/
- src/orchestration/
- src/briefing/
- src/db/ (confirmation kind 追加が必要な範囲)
