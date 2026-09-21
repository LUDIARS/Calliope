---
task: anatomia-program-layers
project: Calliope
kind: 実装
created: 2026-09-21
memory_links:
  - spec/domains/service-runtime.domain.json
  - spec/tasks/2026-09-21-pr193-reland-on-main.md
---
# Anatomia プログラムドメインの層宣言を追加し未分類アンカーを解消する

## 目的

Calliope には `.anatomia/layers.json` が無く、Anatomia の二層ドメイン判定のうち
**プログラム層 (下半分)** が完全に空だった。事業層 (上半分) は
`spec/domains/*.domain.json` で 11 ドメインが正本化済みだが、プログラム層は
リポジトリ自身が層を宣言しないかぎり Anatomia が層を推定しない設計
(`src/domains/program/layer-paths.ts` — 宣言が無いリポジトリは「何も主張しない」)
のため、`anatomia domains program` は全 39 モジュール / 753 シンボルを
`no-layer-rule` として未分類に落としていた。

結果として PR#193 の審査では変更アンカー 137 件が「未分類」として二層ゲートの
advisory に出続けていた。二層ゲート (`src/review/dual-layer-gate.ts`) が数えるのは
**変更アンカーのうち未分類のもの**だけなので、層宣言を入れればこの advisory は
根本から消える。PR#193 の載せ直し
([[spec/tasks/2026-09-21-pr193-reland-on-main.md]]) とは独立した整備項目として、
前 run から残作業に切り出されていたもの。

宣言の置き場所は `.anatomia/layers.json` 以外に無い — ローダー
(`Anatomia/src/domains/program/config.ts`) は `<repo>/.anatomia/layers.json` を
直接読むだけで、`spec/` 配下の代替探索を持たない。Calliope は main の `a7ac931`
で `.anatomia/` をディレクトリごと `.gitignore` していたため、まずこれを
`.anatomia/*` + `!.anatomia/layers.json` の形へ直して層宣言だけを追跡対象に戻す
(git は除外ディレクトリ内のファイルを `!` で再包含できない)。
これは Memoria / Concordia / Anatomia 自身が既に採っている形と同じ。

## 完了条件

- [x] `.gitignore` の `.anatomia/` 総除外を `.anatomia/*` + `!.anatomia/layers.json`
      へ置き換え、層宣言だけを追跡対象にする。解析キャッシュは従来どおり除外を保つ。
- [x] `.anatomia/layers.json` を追加し、Calliope の全モジュールへ層を割り当てる。
      層名は Anatomia の builtin 4 層 (`infrastructure` < `domain` < `application`
      < `presentation`) に合わせ、`order` / `allow` を宣言しないことで builtin の
      依存方向判定をそのまま使う。
- [x] `anatomia domains program --repo .` が `unclassified: 0 module(s), 0 symbol(s)`
      を返す (= 二層ゲートのプログラム層が通る状態)。
- [x] 着地ドメイン (`spec/domains/service-runtime.domain.json`) へ
      `.anatomia/layers.json` のメンバシップを登録する。
- [x] `git diff | anatomia verify` の block 級ゲートを通す。
- [x] 本タスク md を `spec/tasks/` に残す。

## 層の割り当てとその根拠

割り当ては Calliope 自身が `CLAUDE.md` で宣言しているレイヤ分離
(「`clients/`(上流取得) / feature フォルダ(純粋ロジック + engine.ts) /
`routes/`(HTTP) / `db/`(永続化)」) をそのまま写したもので、新しい構造を
発明していない。

| 層 | 対象 | 根拠 |
| --- | --- | --- |
| `infrastructure` | `src/config.ts` / `src/clients/**` / `src/db/**` / repo 直下 | 上流 I/O・永続化・env 解決。ドメインから参照される側 |
| `domain` | `src/refs.ts` と各 feature フォルダ (briefing / calendar / estimation / planning / priority / reschedule / retrospective / risk / scheduler / servicemap / sprint / stocktake / taskgen / tasks / velocity) | 計画成果物を算出する純粋ロジック。`refs.ts` は 20 ファイルから参照される ref 語彙なので domain に置く |
| `application` | `src/app.ts` / `src/index.ts` / `src/orchestration/**` | 合成ルートと常駐オーケストレーション (daily / weekly / loop) |
| `presentation` | `src/routes/**` / `src/ui/**` / `src/servicemap/ui/**` | HTTP の受口と HTML 出力 |

テストは `__tests__` を **被テスト対象と同じ層**に置いた。Memoria / Concordia は
テストを独立層 (`shared`) にしているが、builtin ランキング下では未知の層名が
rank 0 (= infrastructure 相当) として扱われるため、上位層を import する
テストが依存方向違反として数えられてしまう。同層に置けばこの副作用が出ない。

### glob を重ねてはいけない制約

ローダーは glob 文字列を `localeCompare` でソートしてから**先勝ち**で評価する
(`config.ts` の sort → `layer-paths.ts` の `for ... return`)。記述順は効かない。
`*` は 1 階層のみ (`[^/]*`) なので `src/*` が `src/routes/x.ts` を奪うことは
無いが、**同一ディレクトリでは `src/*` が `src/refs.ts` を必ず覆い隠す**
(`"src/*" < "src/refs.ts"`)。src 直下は config / refs / app / index で層が割れるため、
総取りの `src/*` を置かずに 4 本を個別に列挙している。src 直下にモジュールを
足すときは `.anatomia/layers.json` にも 1 行足すこと。

## 検証

- `anatomia domains program --repo .`
  — before: `program domains: 0` / `unclassified: 39 module(s), 753 symbol(s)`
  — after: `program domains: 39` / `layers.json: 46 rule(s)` /
    `unclassified: 0 module(s), 0 symbol(s)`
    (application 3 / domain 29 / infrastructure 4 / presentation 3 モジュール)
- `anatomia verify` は `--repo` で本 worktree を指すこと
  ([[spec/tasks/2026-09-21-pr193-reland-on-main.md]] の Anatomia ゲート節と同じ理由)。

## スコープ (編集可ディレクトリ)

- `.anatomia/layers.json`
- `.gitignore`
- `spec/domains/service-runtime.domain.json`
- `spec/tasks/`
