---
task: 04-<private-reference-004>-client
project: Calliope
kind: 実装
status: pending
created: 2026-07-16
source_session: lictor-9747bcfe-3969-4e12-959d-6cf39d3287fc
memoria_task_id: null
actio_task_id: null
memory_links:
  - E:/Document/Ars/Calliope/docs/design/<private-reference-004>-pm.md
  - E:/Document/Ars/<private-reference-004>/spec/tasks/2026-07-16-01-pm-task-source.md
---
# <private-reference-004>Connector + <private-reference-004> プロジェクトバインド

## 目的

docs/design/<private-reference-004>-pm.md §H3 の実装。<private-reference-004> Hub の projects レジストリを read する
`make<private-reference-004>Client` を追加し、<private-reference-004> project を Calliope の project scope (`<private-reference-004>:<project_id>`)
として優先度解決・plan・sprint・risk に載せられるようにする。

前提 (両方満たすまで着手しない。未充足なら pending のまま理由を報告する):
1. <private-reference-004> 側 projects プラグイン (<private-reference-004>/spec/tasks/2026-07-16-02-projects-plugin.md) がマージ済みで
   read API が確定している。
2. 設計相談 (<private-reference-004>/spec/tasks/2026-07-16-01-pm-task-source.md) の裁定が出ている。

## 完了条件

- `src/clients/<private-reference-004>.ts` — `make<private-reference-004>Client` (factory 規約): `listProjects` / `getProject` /
  `listMembers` / `health`。read-only。zod contract で parse、503 `<private-reference-004>_unconfigured` 規約準拠。
- project scope `<private-reference-004>:<project_id>` が refs (src/refs.ts) の scope 体系に統合され、
  優先度解決・plan 生成が <private-reference-004> scope を受け付ける (既存 scope の挙動は不変 — 回帰テストで担保)。
- タスク取得経路は設計相談の裁定に従って配線する (裁定内容は task md #01 の追記を参照)。
- fixture テスト (clients / scope 統合) 追加、`npm run typecheck` / `npm test` green。

## スコープ (編集可ディレクトリ)

- src/clients/
- src/refs.ts と関係する feature フォルダ (priority / planning / sprint / risk) の scope 対応最小差分
- 各 __tests__/
