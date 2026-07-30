# Calliope 詳細設計 — Actio タスクライフサイクル(自動生成 / 棚卸し)

親設計: [`../../DESIGN.md`](../../DESIGN.md) §4/§6。位置づけ: 2026-07-16 neco 指示
「Actio と接続してタスクの自動生成や棚卸しをする」の設計正本。
既存の read バインド(能力E)に、**生成(generate)と棚卸し(stocktake)の 2 つの提案系**を足す。

共通原則(MUSA / DESIGN §6 を継承):

- タスク正本は Actio。Calliope は**候補の生成と提案**だけを行い、Actio への write は
  **Decision Inbox(confirmation)承認後**にのみ実行する(自動生成タスクが勝手に増殖しない)。
- Calliope 自 DB に task 実体を持たない。候補は confirmation payload(id 参照 + タイトル)として持つ。
- 無言フォールバック禁止。Actio 未設定は 503 `actio_unconfigured`。

---

## G1. Actio write クライアント

既存 `makeActioClient`(read-only)に write を追加する。

- `createTask(input)` — Memoria `shareTaskToActio`(Memoria PR #252)と同じ Actio 契約を使う。
  `kind` / `category` / `creator_type` を必ず保持する(creator_type は `calliope` 系の値で、
  人間起票と区別できること — 棚卸し G3 で自動生成分を選別する鍵になる)。
- `updateTaskStatus(taskId, status)` / `updateTaskPriority(taskId, priority)` —
  棚卸し裁定の実行面。Actio 側の既存 API を使い、Calliope 側に新しい状態遷移を発明しない。
- 認可: service token(Bearer)。破壊操作(削除)は**実装しない** — close は status 遷移で表現し、
  削除が必要な場合は人間が Actio UI で行う(LUDIARS 規約: session 外の破壊 REST 禁止)。

## G2. タスク自動生成(generate)

**何**: 計画成果物から「Actio にあるべきなのに無いタスク」を検出し、候補として提案する。

- **生成ソース(4 系統、いずれも既存テーブルの写像)**:
  1. **sprint carryover** — sprint close 時の carryover のうち Actio task_ref が無いもの。
  2. **risk red フォローアップ** — goal_risk_snapshot が red に遷移した goal に
     「対策検討」タスクが無い場合の候補。
  3. **plan gap** — active plan の entry が参照する task_ref が Actio で見つからない
     (孤児 entry)場合の再起票候補。
  4. **retrospective action** — 週次振り返り(F7)の指摘(velocity drift / scope creep)から
     の改善タスク候補。
- **dedup 必須**: 既存 Actio タスクとの重複(同一 task_ref / タイトル正規化一致)候補は出さない。
  同一候補の再提案は confirmation が pending / rejected のうちは抑止する。
- **フロー**: 日次 orchestration(07:30 JST)で候補生成 → confirmation
  (`kind: task_create`, payload = 候補リスト + 生成根拠)→ Nuntius 通知 → approve で
  G1 `createTask` を実行し、結果(actio task id)を payload に追記。reject は理由必須。
- **API**: `POST /api/tasks/generate`(on-demand 再生成)/ 候補一覧は既存
  `GET /api/confirmations?status=pending` に載る(新 read API を増やさない)。

## G3. タスク棚卸し(stocktake)

**何**: Actio の open タスク全量を定期監査し、陳腐化を検出して整理提案を出す。PM 秘書の棚卸し。

- **検出項目(read + 突合のみ)**:
  1. **aging** — 更新停滞が閾値(既定 14 日、env 可変)を超えた open タスク。
  2. **done 候補** — Memoria agent_runs / plan entry 完了と突合して「実は終わっている」タスク。
  3. **重複候補** — タイトル正規化 + 同一 project での類似ペア。
  4. **priority 陳腐化** — Calliope 優先度解決値と Actio 側 priority の乖離が大きいもの。
- **出力**:
  - `stocktake レポート`(on-demand 合成、保存しない — briefing と同じ方針)。
    `GET /api/tasks/stocktake` で取得、日次 briefing の「棚卸しサマリ」節に統合。
  - 整理提案(close / reprioritize / merge)は confirmation(`kind: task_stocktake`)に積み、
    approve で G1 の status / priority 更新を実行。**auto-apply しない**(他者起票タスクを
    勝手に閉じるのは高リスク)。
- **API**: `POST /api/tasks/stocktake`(再実行)/ `GET /api/tasks/stocktake`(最新レポート)。
- **頻度**: 週次(月曜 08:00 JST、weekly retrospective と同時)+ on-demand。

## 自律性 / 規約整合

- G2 / G3 とも「候補生成 = read + 自 DB 集計」「実行 = confirmation approve 後のみ」。
  DESIGN §6 の 2 段モデルにそのまま載る。confirmation `kind` に `task_create` /
  `task_stocktake` を追加する(F1 の enum 拡張)。
- 個人データ非保持: 候補 payload は task id 参照 + タイトルのみ。
- 二重実装回避: タスク状態機械は Actio、実績突合は Memoria、通知は Nuntius。
  Calliope は写像・閾値判定・提案の永続化だけ。

## 実装順

| 順 | 内容 | 対応タスク |
|---|---|---|
| 1 | G1 write クライアント | spec/tasks/2026-07-16-01-actio-write-client.md |
| 2 | G2 自動生成 | spec/tasks/2026-07-16-02-task-autogen.md |
| 3 | G3 棚卸し | spec/tasks/2026-07-16-03-task-stocktake.md |
