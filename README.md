# Calliope (カリオペ)

MUSA「9女神」の**長(統括)** — PM秘書オーケストレータ。

Actio(タスク/PM) と Schedula(予定/カレンダー) と Memoria(roadmap/goal評価/AI実行実績) を
**バインドして統括**し、目標に沿った計画を引き、他プロジェクト優先度でリスケし、
バグ収束・実装曲線を加味したスプリントを自動設計・管理する単独サービス。

> **MUSA 原則**: エンジンを二重実装しない。タスク正本=Actio / 予定正本=Schedula /
> 解析=Anatomia / 仕様=Praeforma。Calliope はそれらを呼んで**統合・計画するだけ**の薄い統括層。
> 姉妹サービス [Thaleia](../Thaleia) が「企画↔実装」トレース、Calliope が「**計画↔実行**」トレース + 統括。

略称: `Cp`(提案) / ポート: `8891`(提案、正本は Excubitor catalog)

## 何をするか

| 能力 | 概要 |
|---|---|
| A. AI速度加味スケジュール | 過去実装実績で補正した velocity で所要を見積り、依存順に暦日タイムラインへ配置 |
| B. 他PJ優先度リスケ | roadmap 重要度 + 締切で優先度解決、変化検知で自動再配置(クロスPJ調停) |
| C. スプリント自動管理 | Gompertz バグ収束 + タスク流入曲線を織り込みスコープ設計、日次で健全性監視・再設計 |
| D. Googleカレンダー連動 | Schedula 経由で個人予定を read(空き把握)/ 計画を write(可視化) |
| E. Memoria 目標/タスク引継ぎ | Actio(task/goal正本) + Memoria(roadmap/goal_eval) を read でバインド |

詳細設計は [`DESIGN.md`](DESIGN.md) / [`docs/design/`](docs/design/) を参照。

## 開発

```sh
npm install
cp .env.example .env      # 上流 URL/token を設定
npm run db:generate        # drizzle migration 生成
npm run db:migrate         # 適用
npm run dev                # tsx watch で起動 (http://localhost:8891)
npm run typecheck
npm test
```

## 技術スタック

Hono + TypeScript(ESM/NodeNext) + tsx / Drizzle ORM + better-sqlite3(自DB) / vitest。
上流連携は素の `fetch` + Bearer(service token)。構造規約は Thaleia に準拠、永続化は Actio 流。

## 状態

設計 v0.2 完了 / 実装 P0 着手前(Codex 委託予定)。実装フェーズは [`docs/CODEX-P0.md`](docs/CODEX-P0.md)。

## セットアップ TODO (運用)

- [ ] Excubitor catalog に `calliope`(port 8891) を登録(ポート正本化)
- [ ] Cernere に Calliope service 登録 + 上流(Actio/Schedula/Memoria)向け service token 発行
- [ ] Schedula calendar モジュールの双方向化(OAuth consent + write-back)= 別リポ PR(能力D前提)
- [ ] Memoria/Actio の `shareTaskToActio` 拡張(kind/category/creator_type)= 別リポ PR(能力E前提)
