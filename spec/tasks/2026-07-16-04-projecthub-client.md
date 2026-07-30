---
task: 04-projecthub-client
project: Calliope
kind: 実装
status: pending
created: 2026-07-16T00:00:00.000Z
source_session: lictor-9747bcfe-3969-4e12-959d-6cf39d3287fc
memoria_task_id: 532
actio_task_id: null
memory_links:
  - E:/Document/Ars/Calliope/docs/design/projecthub-pm.md
  - E:/Document/Ars/PROJECTHUB/spec/tasks/2026-07-16-01-pm-task-source.md
---
# ProjectHubConnector + PROJECTHUB プロジェクトバインド

## 目的

docs/design/projecthub-pm.md §H3 の実装。PROJECTHUB Hub の projects レジストリを read する
`makeProjectHubClient` を追加し、PROJECTHUB project を Calliope の project scope (`projecthub:<project_id>`)
として優先度解決・plan・sprint・risk に載せられるようにする。

前提 (すべて満たすまで着手しない。未充足なら pending のまま理由を報告する):
1. PROJECTHUB 側 projects プラグイン (PROJECTHUB/spec/tasks/2026-07-16-02-projects-plugin.md) がマージ済みで
   read API が確定している。
2. 設計相談は **2026-07-17 最終裁定済み**: タスク取得は Actio コア tasks の **project_id**
   (値 = PROJECTHUB `projecthub_project.id`) で引く。group 経由ではない。
3. Actio 側の project_id 新設 (Actio/spec/tasks/2026-07-17-01-projecthub-project-tasks.md) が
   マージ済みで、外部 API から project_id 指定でタスクを read できる。

## 完了条件

- `src/clients/projecthub.ts` — `makeProjectHubClient` (factory 規約): `listProjects` / `getProject` /
  `listMembers` / `health`。read-only。zod contract で parse、503 `projecthub_unconfigured` 規約準拠。
- project scope `projecthub:<project_id>` が refs (src/refs.ts) の scope 体系に統合され、
  優先度解決・plan 生成が projecthub scope を受け付ける (既存 scope の挙動は不変 — 回帰テストで担保)。
- タスク取得経路は設計相談の裁定に従って配線する (裁定内容は task md #01 の追記を参照)。
- fixture テスト (clients / scope 統合) 追加、`npm run typecheck` / `npm test` green。

## スコープ (編集可ディレクトリ)

- src/clients/
- src/refs.ts と関係する feature フォルダ (priority / planning / sprint / risk) の scope 対応最小差分
- 各 __tests__/
