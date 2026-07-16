---
task: 01-actio-write-client
project: Calliope
kind: 実装
status: pending
created: 2026-07-16T00:00:00.000Z
source_session: lictor-9747bcfe-3969-4e12-959d-6cf39d3287fc
memoria_task_id: 529
actio_task_id: null
memory_links:
  - E:/Document/Ars/Calliope/docs/design/task-lifecycle.md
  - E:/Document/Ars/Calliope/CLAUDE.md
  - E:/Document/Ars/Memoria/server/routes/task.ts
---
# Actio write クライアント (createTask / updateTaskStatus / updateTaskPriority)

## 目的

タスクライフサイクル設計 (docs/design/task-lifecycle.md §G1) の土台。既存の read-only
`makeActioClient` (src/clients/actio.ts) に write 3 操作を追加し、後続の自動生成 (G2) /
棚卸し (G3) が使う実行面を用意する。

## 完了条件

- `createTask(input)`: Memoria の `shareTaskToActio` (Memoria PR #252) が使う Actio 契約と
  同一エンドポイント・同一フィールドで作成できる。`kind` / `category` / `creator_type` を
  透過し、`creator_type` は Calliope 起票と識別できる値にする。
  実装前に Memoria 側クライアント実装を読んで契約 (パス・スキーマ) を裏取りすること。
- `updateTaskStatus(taskId, status)` / `updateTaskPriority(taskId, priority)`:
  Actio の既存 API を使う。Actio 側に新規エンドポイントが必要な場合は実装せず、
  タスクを status: pending のまま「Actio 側 API 不足」を PR 説明と完了報告に明記して返す。
- 削除 API は実装しない (close は status 遷移で表現)。
- 無言フォールバック禁止: 上流 4xx/5xx は throw、未設定は 503 `actio_unconfigured` (既存規約)。
- zod スキーマは src/clients/contracts.ts に追加、レスポンスを parse する。
- `src/clients/__tests__/` に fixture テスト (成功 / 4xx throw / 未設定 503) を追加。
- `npm run typecheck` / `npm test` green。

## スコープ (編集可ディレクトリ)

- src/clients/
- src/clients/__tests__/
- (参照のみ: E:/Document/Ars/Memoria の Actio 共有クライアント、E:/Document/Ars/Actio の API 実装)
