# Calliope — Claude Code ルール

## 性格 / 役割

Calliope は MUSA「9女神」の**長(統括)** = PM秘書オーケストレータ。
Actio(タスク) / Schedula(予定) / Memoria(roadmap・goal評価・AI実行実績) を**バインドして統括**する。

**最重要原則(MUSA 継承): エンジンを二重実装しない。** タスク正本=Actio、予定正本=Schedula、
解析=Anatomia、仕様=Praeforma、個人プロファイル=Cernere。Calliope はこれらを HTTP で呼んで
統合・計画するだけ。Calliope 自 DB が持つのは**計画成果物のみ**(plan/sprint/velocity集計/
reschedule履歴/priority解決値)。task/event/goal の実体は持たない(id 参照のみ)。

姉妹サービス Thaleia(企画↔実装トレース)と同じ「bind, don't reimplement」思想。

## ブランチ + PR 運用

- `feat/*` ブランチ → PR → squash merge。**main 直 push 禁止**。
- AI 実装は 1 PR に集約(細切れ commit を多数 push しない)。
- 破壊的操作(reset --hard / force push)前に安全な代替を検討。

## コード規約

- 共通は `coding-conventions` skill(= AIFormat/RULE_CODE.md)が正本。
- **SRP / ファイル分割必須**。1文で説明して「と」「かつ」が複数出るクラスは分割。
- **無言フォールバック禁止**: 上流 4xx/5xx は握り潰さず `throw` し、route で 502/503 に写す。
  上流 URL/token 未設定は mock に落とさず 503(`{ error: '<svc>_unconfigured', hint }`)。
- ESM + NodeNext。**import は `.ts` 拡張子付き**(例 `import { loadConfig } from './config.ts'`)。
- レイヤ分離(Thaleia 準拠): `clients/`(上流取得) / feature フォルダ(純粋ロジック + engine.ts) /
  `routes/`(HTTP) / `db/`(永続化)。純粋関数(velocity算出/scheduler/priority)に I/O を持ち込まない
  (fixture テスト可能に保つ)。

## データ / 個人情報

- 個人データ(name/email/token)を Calliope DB に保管しない([[project_personal_data_rule]])。
  task/event/goal は id 参照 + 非個人フィールドのみ read。Google トークンは Schedula/Cernere が保持。
- plan は破壊更新せず supersede で版管理。reschedule は before/after を必ず log。

## 自律性境界

- 低リスク(自PJ内の順序変更・計画ブロック作成)= auto-apply + 事後通知。
- 高リスク(他PJ preempt・締切スリップ・Google 書込・人間ゲート再配置)= `409 human_confirmation_required`。

## 上流連携

- Actio / Schedula / Memoria への呼び出しは `src/clients/<svc>.ts` の `make<Svc>Client` factory。
  `fetch` + 末尾スラッシュ正規化 + `!res.ok` throw + token あるときのみ Bearer。
- 破壊操作は Cernere session / WebSocket 経由(LUDIARS 規約: session 外の破壊 REST 禁止)。

## ビルドとテスト

- `npm run typecheck`(tsc --noEmit) / `npm test`(vitest run) を PR 前に green。
- test は各 feature フォルダ直下 `__tests__/*.test.ts` にコロケーション。純粋関数を fixture でテスト。

## spec / 設計

- 設計正本: `DESIGN.md`(概要) + `docs/design/scheduling.md`(A/B/C) + `docs/design/calendar-memoria.md`(D/E)。
- 実装フェーズ: `docs/CODEX-P0.md` 以降。

## ポート / 環境

- ポート正本は **Excubitor catalog**([[port-source-rule]])。コードのハードコード既定 8891 は暫定。
- env は素の `process.env` を `src/config.ts` の `loadConfig()` で解決。Excubitor 別名(`_API_URL`/`_URL`)を
  `firstEnv(...)` で吸収。

## 参照

- `coding-conventions` / `port-source-rule` / `decision-metrics` skill
- 姉妹: `../Thaleia`(構造の手本) / 正本: `../Actio`(task) / `../Schedula`(event) / `../Memoria`(roadmap)
