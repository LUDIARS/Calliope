# Calliope 詳細設計 — PM運用拡張(F1-F7: 承認キュー / ブリーフィング / What-if / リスク / 精度 / コスト / 振り返り)

親設計: [`../../DESIGN.md`](../../DESIGN.md) §5/§6。
位置づけ: A-E が「計画エンジン」であるのに対し、本書は **PM秘書としての運用面**の追加提案。
2026-07-09 仕様レビュー([`../reviews/2026-07-09-spec-review.md`](../reviews/2026-07-09-spec-review.md))の追加提案として起案。
F1 は自律性モデル(DESIGN §6 / レビュー B-3)の前提なので**必須**、F2-F7 は任意提案(採否は neco)。

共通原則: すべて **read + 自DB集計 + 通知**のみで構成し、エンジンを二重実装しない(MUSA 原則)。
新規の上流 write は F1 の approve 実行(= 既存 apply の遅延実行)だけ。

---

## F1. Decision Inbox(承認キュー)— 必須

**何**: 高リスク操作の `409 human_confirmation_required` を「その場で拒絶して終わり」ではなく、
**裁定待ちレコードとして永続化**し、人間がまとめて裁定できるキューにする。PM秘書の「ご判断ください箱」。

- **データ**: `confirmation`(id, kind[plan_apply/reschedule/calendar_write], payload JSON(diff+risk 全文),
  status[pending/approved/rejected/expired], created_at, decided_at, decided_by)。
- **API**: `GET /api/confirmations?status=pending` / `POST /api/confirmations/:id`(`{decision: approve|reject, reason?}`)。
  approve で元操作(plan apply 等)を実行し、結果を payload に追記。reject は理由必須で記録のみ。
- **フロー**: 高リスク判定(scheduling.md §5.3)→ 409 + `confirmation_id` を返しつつレコード作成 → Nuntius 通知
  → 裁定 → 実行/破棄。**期限 24h で expired** とし、期限切れは最新状態で再提案(古い diff を実行しない)。
- **規約**: payload は task id 参照 + タイトルのみ(個人データ非保持)。裁定履歴は破壊更新しない。
- **Phase**: **P3**(自律性適用の実装と同時。分離不能)。

## F2. Daily Briefing(日次ブリーフィング)

**何**: 日次ループ(scheduling.md §1)の `notify` を具体化。毎朝1通で「秘書の朝報告」を出す:
今日の計画(レーン別のAI作業)/ 要裁定(F1 pending)/ 逸脱アラート(C の health)/ 直近の締切と人間ゲート予定。

- **API**: `GET /api/briefing/today`(再取得用)。**保存しない** — plan/sprint/confirmation から on-demand 合成
  (計画成果物の写像なので新テーブル不要 = 二重実装しない)。
- **通知**: Nuntius 経由で 1 通に集約(細切れ通知しない)。Nuntius 未設定は 503 ではなく「通知スキップ + 警告ログ」
  (briefing は副作用なし read なので、無言フォールバック禁止の対象外とする明示的例外)。
- **Phase**: **P3.5**(P3 直後の小タスク。F1 の pending 一覧が材料になるため P3 以降)。

## F3. What-if シミュレーション(dry-run 比較)

**何**: 「締切を1週ずらしたら?」「レーンを1本増やしたら?」を**保存せずに**試算し、
現 active plan との diff + リスクを返す。409 裁定(F1)や締切交渉の判断材料。

- **API**: `POST /api/plan/simulate`(`{changes: {due_overrides?, lanes?, priority_overrides?}}`)
  → `{diff, risk, projected_completions}`。DB 書込なし・通知なし。
- **実装**: 能力A のスケジューラ(純関数)+ 能力B の `comparePlan`/`assessRisk` をそのまま呼ぶだけ。
  新ロジックゼロ。純関数性(fixture テスト可)の配当。
- **Phase**: **P3**(comparePlan 実装と同時が最安)。

## F4. Risk Register(締切リスク常時評価)

**何**: 日次ループで goal ごとに `projected_completion`(critical-path × D̂ 信頼帯)vs 締切を評価し、
green/amber/red のリスクレベルを履歴化。「気づいたら赤」を防ぐ PM の基本動作。

- **データ**: `goal_risk_snapshot`(id, goal_ref, date, projected_completion, deadline, level[green/amber/red],
  factors JSON[velocity 信頼度・依存滞留・scope creep])。curve_snapshot と同粒度の日次履歴。
- **判定**: red = p80 予測で締切超過 / amber = p50 は間に合うが p80 が超過 / green = p80 でも余裕。
  (D̂ の信頼帯 = velocity IQR。scheduling.md §2.3)
- **接続**: F2 ブリーフィングの「逸脱アラート」と §5.3 リスク判定の入力。red 遷移時は即時通知(日次を待たない)。
- **Phase**: **P2 後半**(gompertz/critical-path 取込と同時が効率的)。

## F5. 見積り精度トラッキング — P1a 同梱推奨

**何**: `task_estimate`(human/analogy/llm)vs 実所要の誤差を継続計測。
EstimationService の学習が効いているか・どの source が信頼できるかを可視化する。
**計測は最初から仕込まないと後から遡れない**ため、P1a に同梱する。

- **指標**: source 別の MAPE / bias(過小・過大の偏り)/ サンプル数。週次ウィンドウ。
- **データ**: 新テーブル不要。実績確定時に task_estimate と agent_runs を突合し、
  `velocity.distribution` に source 別誤差を含める(既存スキーマの JSON 列で完結)。
- **API**: `GET /api/velocity/accuracy`。
- **Phase**: **P1a に含める**(小)。

## F6. コスト/トークン予算(外部前提としてクローズ)

**何**: agent_runs の実行コスト(トークン/金額)を PJ 別に集計し、decision-metrics の費用軸を計画に反映。
予算超過 PJ への新規タスク投入をブリーフィングで警告する。

- **前提監査済み (2026-07-11)**: Memoria `agent_runs` にコスト/トークン列は無い。Calliope では推測・二重集計しない。
- **Phase**: Calliope の実装対象外としてクローズ。Memoria が正本となるコスト契約を追加した時だけ、新しい明示タスクとして再評価する。

## F7. 週次振り返り(velocity レビュー)

**何**: 週次で k_p ドリフト / scope creep 率 / starvation 発生(aging 発動回数)/ F5 の精度推移を
1 レポートに集約し Nuntius へ。人間が weights(§3.2)や sprint 長を調整する材料。

- **データ**: 既存テーブル(velocity / sprint / reschedule_log / priority.breakdown)からの集計のみ。
- **Phase**: **P5**(UI と同時期。まず通知テキストで出し、UI は後追い)。

---

## 採用推奨順

| 順 | 提案 | Phase | 理由 |
|---|---|---|---|
| 1 | **F5** 精度トラッキング | P1a 同梱 | 小さく、最初から計らないと遡れない |
| 2 | **F4** Risk Register | P2 後半 | gompertz/critical-path 取込と同時が最安 |
| 3 | **F1** Decision Inbox | P3 | 自律性モデルの前提(必須) |
| 4 | **F3** What-if | P3 | comparePlan の流用のみ、新ロジックゼロ |
| 5 | **F2** Daily Briefing | P3.5 | F1/F4 の出力が揃ってから 1 通に束ねる |
| 6 | **F7** 週次振り返り | P5 | 集計のみ、急がない |
| - | **F6** コスト予算 | 外部前提 | Memoria に正本データが無いため Calliope では実装しない |

## 自律性 / 規約整合

- F 系は F1 の approve 実行を除きすべて read + 自DB 集計 + 通知 → 低リスク(auto)。
- 個人データ非保持: briefing / risk / confirmation payload は id 参照 + タイトルのみ。Nuntius 送信文にも email 等を含めない。
- 二重実装回避: gompertz/critical-path は Actio、コスト集計元は Memoria、通知は Nuntius。Calliope は写像と閾値判定だけ。
