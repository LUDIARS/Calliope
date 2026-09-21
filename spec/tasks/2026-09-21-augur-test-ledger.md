---
task: augur-test-ledger
project: Calliope
kind: テスト
created: 2026-09-21
memory_links:
  - spec/test-plan.md
  - spec/domains/service-runtime.domain.json
---
# Augur テスト台帳を整備し Revisor のドメイン別テスト選択を効かせる

## 目的

Calliope には Augur のテスト台帳 `.augur/tests.jsonl` が無い。Revisor の CI
(`Revisor/src/ci.mjs:199` の `existsSync(join(worktreePath, ".augur", "tests.jsonl"))`)
はこれを見て台帳の有無を判定しており、無い場合は

- 変更ドメインに紐づくテストを選べず **毎回フルスイートを実行**する
  (所見「Augur 台帳未整備 (全体スイートを実行)」)
- レビューレポートの動作確認欄が `台帳未整備` に落ち、テスト実行の証跡を
  ドメインへ帰属できない (`Revisor/src/review-report.mjs:45`)

という状態が続く。実際に PR#193 (2026-09-21 マージ) と PR#1933 (同日マージ) の
双方でこの所見が出ており、PR#1933 では「動作ブロック: 台帳未整備」として
報告された。台帳が入れば `testSelectionMode` が `registered-non-code` へ切り替わり、
ドキュメント／設定のみの変更でフルスイートを回す無駄も無くなる。

本タスクは PR#193 / PR#1933 の実装内容とは独立した CI 側の整備項目で、
どちらの PR のスコープにも含めていない。

## 完了条件

- [ ] Calliope で Augur のテスト実行を記録し、`.augur/tests.jsonl` を生成する。
- [ ] 台帳を追跡対象にするか除外するかを決め、`.gitignore` を明示的に整える。
      追跡する場合は `.anatomia/layers.json` と同じく `.augur/*` +
      `!.augur/tests.jsonl` の形にする (git は除外ディレクトリ内のファイルを
      `!` で再包含できないため、ディレクトリ総除外にしないこと。
      [[spec/tasks/2026-09-21-anatomia-program-layers.md]] と同じ制約)。
- [ ] 台帳のテストが `spec/domains/*.domain.json` の 11 ドメインへ帰属し、
      ドメイン別の選択が成立することを確認する。
- [ ] Revisor の次の PR で所見「Augur 台帳未整備 (全体スイートを実行)」が消え、
      レビューレポートの動作確認欄が `台帳未整備` 以外になることを確認する。
- [ ] `spec/test-plan.md` に台帳の位置づけ (何が正本で、どう更新するか) を追記する。

## スコープ (編集可ディレクトリ)

- `.augur/`
- `.gitignore`
- `spec/test-plan.md`
- `spec/tasks/`
