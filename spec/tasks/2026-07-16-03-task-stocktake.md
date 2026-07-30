---
task: 03-task-stocktake
project: Calliope
kind: 実装
status: pending
created: 2026-07-16T00:00:00.000Z
source_session: lictor-9747bcfe-3969-4e12-959d-6cf39d3287fc
memoria_task_id: 531
actio_task_id: null
memory_links:
  - E:/Document/Ars/Calliope/docs/design/task-lifecycle.md
  - E:/Document/Ars/Calliope/docs/design/pm-extensions.md
---
# タスク棚卸し (stocktake) — 陳腐化検出 + 整理提案

## 目的

docs/design/task-lifecycle.md §G3 の実装。Actio の open タスク全量を定期監査し、
aging / done 候補 / 重複候補 / priority 陳腐化を検出、棚卸しレポートと整理提案
(confirmation `kind: task_stocktake`) を出す。

前提: 2026-07-16-01-actio-write-client (status/priority 更新) がマージ済みであること。
未マージなら着手せず pending のまま報告する。

## 完了条件

- 検出 4 項目 (design §G3) が純粋関数 (`src/stocktake/engine.ts` 等) で実装され、
  各項目に fixture テストがある。閾値 (aging 既定 14 日) は env で可変。
- `GET /api/tasks/stocktake` が最新レポートを on-demand 合成で返す (保存しない)。
  `POST /api/tasks/stocktake` で再実行できる。
- 整理提案 (close / reprioritize / merge 候補) は auto-apply されず、confirmation
  (`kind: task_stocktake`) に積まれ、approve で updateTaskStatus / updateTaskPriority が
  実行される (merge は提案のみで実行なし)。reject は理由必須。
- 週次スケジュール (月曜 08:00 JST、weekly retrospective と同時) に組み込み、
  daily briefing に棚卸しサマリ節が載る。
- payload は task id 参照 + タイトルのみ (個人データ非保持)。
- `npm run typecheck` / `npm test` green。

## スコープ (編集可ディレクトリ)

- src/stocktake/ (新設)
- src/routes/
- src/orchestration/
- src/briefing/
- src/retrospective/
- src/db/ (confirmation kind 追加が必要な範囲)
