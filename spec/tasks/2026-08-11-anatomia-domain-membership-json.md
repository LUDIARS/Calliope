---
task: anatomia-domain-membership-json
project: Calliope
kind: 実装
created: 2026-08-11
memory_links:
  - spec/architecture-domains.md
---
# Anatomia ドメイン membership の JSON 化 + タスク生成の AIFormat spec 追加

## 目的

PR LUDIARS/Calliope#193 のマージブロッカーのうち、
「対象ドメイン欠如」と「domain/spec 定義不足 (`PR_GATE_NEEDS_HUMAN`)」を解消する。

直接の原因は membership 定義のファイル形式。`.anatomia/domains/calliope.yaml` は
YAML で書かれていたが、Anatomia の ontology ローダ (`src/domains/ontology.ts` の
`loadFromDir`) は `.json` / `.mjs` / `.js` しか読まず YAML を無視する。
定義はあるのに解析上は 0 ドメインとなり、変更関数が全て unassigned になって
`target domain is still missing` でブロックされていた。

あわせて、PR 差分が実装した範囲に対応する AIFormat 準拠の spec が無く、
レビュアーが「対象ドメインと spec の責務・境界を指定してほしい」と
`PR_GATE_NEEDS_HUMAN` を報告していた。

## 完了条件

- [x] `.anatomia/domains/calliope.yaml` を廃し、同じ 6 ドメインを
      `<domain>.domain.json` (`name` / `description` / `presetRules` /
      `templateRules` / `membership[].pathPattern` / `specRefs`) で定義する。
- [x] `src/` の production TypeScript が **未帰属 0 件・重複所有 0 件**で
      いずれか 1 ドメインに帰属する (検証済み: 100 ファイル)。
- [x] `__tests__/` を membership に含めない (テストは仕様を検証する側であり
      業務ドメインを所有しない — Revisor review-gate の非コード変更ルールと整合)。
- [x] AIFormat の分類フォルダへ spec を置く。PR 差分が実装した範囲のみ:
      `spec/feature/task-generation.md` (機能) と
      `spec/interface/task-generation-api.md` (HTTP 境界)。
- [x] `spec/architecture-domains.md` を JSON 正本へ追従させ、
      「YAML は読まれない」事実と `pathPattern` の書式を明記する。
- [x] `spec/tasks/2026-07-16-02-task-autogen.md` から新 spec を参照する。

## スコープ (編集可ディレクトリ)

- `.anatomia/domains/`
- `spec/feature/` (新設)
- `spec/interface/` (新設)
- `spec/architecture-domains.md`
- `spec/tasks/`

コード (`src/`) は変更しない。本タスクはドメイン帰属と仕様記述のみを扱う。

## 実装メモ (2026-08-11)

- 6 個の domain JSON と対応する architecture/feature/interface spec を追加した。
- membership の `pathPattern` は JS RegExp source。パスは `/` 区切りに正規化された
  うえで照合されるため、`(^|/)src/<dir>/[^/]+\.ts$` の形にすると
  フォルダ直下だけを拾い `__tests__/` を自然に除外できる。
- `src/db/` だけは `repositories/` の一段深さがあるため
  `(^|/)src/db/([^/]+/)?[^/]+\.ts$` とした。

## 追記 (2026-09-21) — 正本を `spec/domains/` へ移設

本タスクが置いた `.anatomia/domains/*.domain.json` は、その後 main が
`spec/domains/` へドメイン定義を整備し `.anatomia/` を `.gitignore` した
(`a7ac931`) ことで読まれなくなった。Anatomia の `resolveCommittedOntologyDir`
は `spec/domains` → `spec/data/ontology` → `.anatomia/domains` の順に探し、
最初に見つかった 1 ディレクトリだけを読むため、`spec/domains/` がある限り
`.anatomia/domains/` は完全に無視される。

そのため PR#193 の載せ直し (`spec/tasks/2026-09-21-pr193-reland-on-main.md`) で
`.anatomia/domains/` を廃し、本 PR 固有の帰属だけを `spec/domains/` へ移した。
**「JSON で書く」という本タスクの結論は有効で、置き場所だけが変わった。**
