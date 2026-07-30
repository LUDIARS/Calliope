---
task: 05-projecthub-sprint-progress
project: Calliope
kind: 実装
status: pending
created: 2026-07-16T00:00:00.000Z
source_session: lictor-9747bcfe-3969-4e12-959d-6cf39d3287fc
memoria_task_id: 533
actio_task_id: null
memory_links:
  - E:/Document/Ars/Calliope/docs/design/projecthub-pm.md
---
# PROJECTHUB プロジェクトのスプリント管理 + 進捗レポート

## 目的

docs/design/projecthub-pm.md §H4 の実装。sprint 設計/replan/close (能力C) を `projecthub:*` scope に
適用し、PJ 別進捗レポート API と週次配信を追加する。Calliope が PROJECTHUB の学生 PJ に対して
PM 秘書として機能する中核。

前提: 2026-07-16-04-projecthub-client がマージ済みであること。未マージなら着手せず報告する。

## 完了条件

- sprint 設計/replan/close が `projecthub:<project_id>` scope で動作する。velocity source は
  設計相談 (PROJECTHUB/spec/tasks/2026-07-16-01-pm-task-source.md) の裁定値を使う。
- Gompertz バグ収束の初期データが無い PJ では流入予約のみの縮退モードで sprint を設計できる。
  縮退は明示ログ + レポート表記 (無言フォールバック禁止)。
- `GET /api/projecthub/progress` — PJ 別の sprint health / burndown / risk / 停滞タスクを
  on-demand 合成 (保存しない)。
- 週次で Nuntius `calliope.projecthub.weekly` topic に運営者向けレポートを配信
  (Nuntius 未設定時は briefing 同様 skip + 警告)。
- 学生 PJ への書込系 (タスク生成・リスケ適用) は confirmation 経由のみ (auto-apply 禁止)。
- fixture テスト追加、`npm run typecheck` / `npm test` green。

## スコープ (編集可ディレクトリ)

- src/sprint/
- src/risk/
- src/routes/
- src/orchestration/
- src/retrospective/
- 各 __tests__/
