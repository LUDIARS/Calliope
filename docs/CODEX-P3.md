# Codex 実装仕様 — Calliope P3（能力B / 自律リスケ / Decision Inbox / What-if）

正本: `DESIGN.md` §6-§7、`docs/design/scheduling.md` §1・§5、`docs/design/pm-extensions.md` F1/F3。
専用委託書が未作成のため、本書で実装契約を固定する。

## Definition of Done

1. 変化種別・日次07:30 JSTからpriority/velocity/sprint healthを更新し、active planと再計画を比較する。
2. plan diffをadded/removed/moved（前倒し/後ろ倒し/lane変更）として返し、全提案を監査する。
3. 締切slip、稼働中cross-PJ preempt、人間gate移動は高リスク。それ以外の未着手・同一PJ変更のみauto-applyする。
4. 高リスクは409とconfirmationを返し、approveまでplanを適用しない。rejectは理由必須。
5. confirmationは24時間でexpired。stale/expiredの旧diffは適用せず、最新状態から再提案する。
6. What-ifはlanes/priority/due overrideをDB非書込で試算し、diff/risk/projected completionを返す。
7. Memoria goal_evalの月内進捗遅れをpriority urgencyへ反映する。

## API

- `POST /api/reschedule/trigger` — manual/event/daily trigger。低リスク200 applied、高リスク409。
- `GET /api/reschedule/log` — proposed/applied/rejected/expiredを含む監査履歴。
- `GET /api/confirmations?status=` — 24h expiry反映後のDecision Inbox。
- `POST /api/confirmations/:id` — `{decision, reason?, decidedBy?: "human"}`。裁定者は
  service token から個人を認証できないため、非個人 alias `human` のみを記録する。
- `POST /api/plan/simulate` — dry-run。DB・通知への副作用なし。

## 自律性・通知

- auto-applyは低リスクだけ。高リスクはconfirmation作成とproposal logを同一transactionで保存する。
- approveはactive planの一致を再検証し、supersede/apply/decision/logを同一transactionで行う。
- Nuntiusは認証済project contextがCalliopeに未設定のため送信せず、レスポンスの
  `notificationStatus=not_sent_missing_authenticated_project_context`で明示する。

## P3の外

- F2 Daily BriefingはP3.5。
- Schedula/Google writeとcalendar confirmationはP4。
- 外部PM webhookの受信adapterは外部PM採用後。現時点はtrigger APIがevent境界。

## 受け入れ基準

- [x] low-risk diffがauto-applyされ、旧activeがsupersededになる。
- [x] high-risk diffが409となり、approveまでactiveが変わらない。
- [x] approve/reject/expired/staleの状態遷移と監査結果が一致する。
- [x] What-if前後でplan件数が変わらない。
- [x] 07:30 JSTの次回時刻計算が日跨ぎを含め決定的。
- [x] migration/typecheck/testがgreen。
