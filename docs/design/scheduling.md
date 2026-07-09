# Calliope 詳細設計 v0.2 — スケジューリング / 自動リスケ / スプリント自動管理

対象能力: A(AI速度加味スケジュール) / B(他PJ優先度リスケ) / C(スプリント自動設計・管理)
親設計: [`../../DESIGN.md`](../../DESIGN.md)(設計書 v0.2)§5。本書はその A/B/C をアルゴリズム粒度に詳細化する。
作成: 2026-07-09 / 設計: Claude(Opus) / 実装委託: Codex
改訂: 2026-07-09 仕様レビュー反映([`../reviews/2026-07-09-spec-review.md`](../reviews/2026-07-09-spec-review.md) A-1/A-2/B-1/B-2/B-5/B-7/C-4/C-5)

---

## 0. 設計の前提 — この環境の資源モデル

**通常の PM ツールと決定的に違う点**: LUDIARS 環境では人間は実装に手を動かさない。実装は AI エージェント(Concordia セッション / Codex / Claude)が自走する。よってスケジュールが配分する資源は:

| 資源 | 実体 | 制約 |
|---|---|---|
| **AIスループット** | 同時稼働できるエージェント数 × 稼働速度(velocity) | 並列数の上限、依存関係 |
| **人間の意思決定ゲート** | neco の設計承認・レビュー・方針判断 | Schedula/Googleカレンダーの空き時間 |

→ スケジュールは「9-5 の人間工数に詰める」のではなく、**「依存順に AI 作業を並べ、AI velocity で所要を見積もり、人間ゲートだけカレンダー空きに合わせる」**問題。この視点が A/B/C 全体を貫く。

---

## 1. 統合オーケストレーションループ (A/B/C の結合点)

A/B/C は独立機能ではなく、日次(および event 駆動)の1本のループで結合する。共有基盤は **Velocity モデル(§2)** と **Priority モデル(§3)**。

```
毎日 07:30 (cron) + event trigger 時:
  1. refreshVelocity()        # §2  実績から AI 速度を再集計
  2. refreshPriority()        # §3  roadmap + override + 締切で優先度解決
  3. updateSprintHealth()     # §6 (C) バグ収束/burn-down 更新、逸脱判定
  4. if drift検知:            # §5 (B)
       proposal = reschedule()
  5. plan = generateOrPatchPlan()   # §4 (A)
  6. applyByAutonomy(plan, proposal) # v0.1 §6  低リスクauto / 高リスク確認
  7. notify(Concordia/Nuntius)
```

- **A** = 5. 計画生成。**B** = 4. 変化検知→再計画。**C** = 3. スプリント健全性監視と再設計。
- 3つとも Velocity と Priority を入力に共有するので、この2モデルを先に定義する。
- 実行時刻は Memoria goal_eval(毎朝 07:00, calendar-memoria.md E.1)の**後**に固定する
  (05:00 だと常に前日の評価で計画してしまう)。将来は eval 完了イベント駆動へ。

---

## 2. 共有基盤①: Velocity モデル (AI実装速度)

> **原則(neco 指示)**: AI 実装速度は**過去の実装実績値をベースに補正する**。見積りは固定値ではなく、実績(`agent_runs` 実所要・完了タスク実績)で継続的にキャリブレーションされる。新規タスクの所要予測 = 見積り × 実績由来の補正係数 `k_p`、実績が付くたびに `k_p` と該当見積りを再学習(§2.3)。cold-start 時のみ暫定係数から入り、実績蓄積で自プロジェクト実績へ収束させる。

### 2.1 入力データ
| ソース | 取得 | 内容 |
|---|---|---|
| Memoria `agent_runs` | MemoriaConnector read | task_id, started_at, finished_at, status, agent, model — **AI委託の実所要時間の一次ソース** |
| Actio 完了タスク | ActioConnector read | creatorType='ai', estimatedMinutes, completedAt, (開始時刻) |
| Actio `pm_task_snapshots` | 〃 | created→closed の時系列(所要の裏取り) |

### 2.2 見積り(estimation)— 前提の欠損補完
**課題**: スケジュールには全タスクに effort 見積り E_t が要るが、Actio `tasks.estimatedMinutes` / `pm_tasks.estimatedHours` は**疎(未入力多数)**の可能性が高い。
**対策**: Calliope が未見積りタスクを推定する `EstimationService`:
- 一次: 類似タスク(同カテゴリ・同ラベル)の実績 median を割当(analogy-based)。
- 二次(類似無し): LLM(`claude -p`)で title/details からサイズ(S/M/L → 分)を推定。
- 推定値には `estimate_source` (human/analogy/llm) と信頼度を付与し、実績が付いたら上書き学習。

### 2.3 速度算出
プロジェクト/カテゴリ p ごとに:
- **見積り誤差係数** `k_p = median( D_t / E_t )` (完了 AI タスクの実所要 D_t ÷ 見積り E_t)。actual が estimate の何倍か。
- **絶対スループット** `Θ_p = Σ E_t(完了) / window_days` (単位期間に消化した effort 量。並列・待ち・調整コミを含む実効値)。
- **予測所要** 新タスク t: `D̂_t = E_t · k_p`、信頼帯は IQR から。
- **cold-start**: ベイズ収縮で確定: `k_p' = (n_p·k_p + n_0·k_0) / (n_p + n_0)`(n_0 = 5)。
  `k_0` = 全PJ横断の median(横断サンプルが5件以上あるとき)、それも無ければ 1。
  n_p 増で自 PJ 実績へ自然に重み移行する。`velocity.sample_size` を必ず保持し、信頼度として下流に伝播。

### 2.4 並列容量
- 同時稼働エージェント数 C は Concordia(session coordinator)から取得 or 設定値。
- スケジューラの容量 = C レーン(§4)。将来 Concordia 実データ結線。当面は設定 `CALLIOPE_AGENT_LANES`。

→ 出力: `velocity` テーブル(PJ/カテゴリ, 期間, k_p, Θ_p, 分布, sample_size, 出典)。
カテゴリ横断(PJ 全体)の行は `category='*'` の番兵で表す(NOT NULL のまま)。全PJ横断(k_0 用)は `project_ref='*'`。

---

## 3. 共有基盤②: Priority モデル

### 3.1 入力(粒度が3層に分散)
| 層 | ソース | 値 |
|---|---|---|
| プロジェクト/事業ライン | Memoria roadmap `services.json` の `member.importance` / line | 1-3 |
| 目標(goal) | Actio `tasks.kind=goal` の priority | low/med/high/critical |
| タスク | Actio `tasks.priority` / `pm_tasks.priority` | low/med/high/critical |
| 締切 | 各タスク due_at | 日数 |
| 手動 override | Calliope `priority` テーブル | 明示指定 |

### 3.2 合成優先度スコア
```
P(t) = w1·norm(proj_importance)      # 事業ライン重要度
     + w2·norm(goal_priority)        # 目標の優先度
     + w3·norm(task_priority)        # タスク自体の優先度
     + w4·urgency(due_at)            # 締切逼迫度
     + w5·aging(wait_days)           # starvation ガード(§5.4)

urgency(due_at):
  due_at 無し        → 0(中立。締切項は加点しない)
  days_to_due ≥ 0    → clamp( (H - days_to_due) / H , 0, 1 )   # H=計画ホライズン(例30日)
  days_to_due < 0    → 1(飽和)。超過日数は breakdown に overdue_days として記録し
                        リスク判定(§5.3)へ流す(スコアは 1 で頭打ち)

aging(wait_days) = min( wait_days / A_max , 1 )   # A_max 既定14日
  wait_days = そのタスクを最初に ready と判定した計画サイクルからの経過日数。
  起点は priority テーブルの first_ready_at に永続化(P1b で列追加)。
```
- 手動 override があれば該当項を固定。weights は設定可、既定は roadmap 重視(w1 大)。
  w5 は小さく始める(順位の微押し上げ用。優先度の主構造を壊さない)。
- **decision-metrics 整合**: 金銭/日数コストは資源制約でないため、優先度は「主目的一致度・目的達成度」寄りの重みにできる(neco 設定次第)。

→ 出力: `priority` テーブル(PJ/goal/task → 解決スコア + 内訳)。

---

## 4. 能力A — AI速度を加味したスケジュール

### 4.1 入出力
- 入力: 対象 goal(群) / 未完タスク DAG(Actio critical-path の blockedBy) / D̂_t(§2) / P(t)(§3) / 人間ゲート要否 / Schedula 空き。
- 出力: `plan` + `plan_entry[]`(task, start, end, lane, 予定リンク, 確信度)。

### 4.2 アルゴリズム: 優先度リスト法 × C レーン(list scheduling)
RCPSP(資源制約付き)は NP 困難なので、**critical-path + priority を種にした優先度リスト・ヒューリスティック**を採用(既存 smart-scheduler の DP≤20/greedy>20 と同系統だが、週次グリッドでなく**暦日タイムライン**へ拡張)。

```
tasks = topologicalSort(DAG)          # 依存順
ready = { t | 全依存が完了予定 }
lanes = C 本(各レーンは "次に空く時刻" を持つ)
while ready 空でない:
   t = argmax P(t) over ready         # 最優先の ready タスク
   if t が人間ゲート:
       slot = Schedula.nextFreeSlot(neco, gate_minutes(t))   # カレンダー空きへ(所要は下記)
       start = max(deps_finish(t), slot.start)
   else:
       lane = earliestFreeLane(lanes)
       start = max(deps_finish(t), lane.freeAt)
       lane.freeAt = start + D̂_t
   plan_entry(t, start, start+D̂_t, lane)
   ready を更新(t 完了で解ける依存)
```
- **人間ゲートの所要 `gate_minutes(t)`**: AI velocity(k_p)は**適用しない**(人間の承認/レビュー時間は
  AI 実績と無関係)。既定 30分、ゲート種別ごとに設定で上書き(例: goal 承認=30分 / PR マージ=15分)。
- **暦日への写像**: start/end は絶対日時。AI レーンは連続稼働可(24h)だが、人間ゲート・外部待ち(CI, レビュー)は blocking として D̂ に織り込むか別 entry 化。
- **確信度**: D̂ の信頼帯 × velocity.sample_size から entry ごとに算出。低確信度 entry は「暫定」マークで apply を保守的に。

### 4.3 Schedula 連携
- 空き取得: `SchedulaConnector.freeBusy(range)`。**P1c 時点では Schedula 側 freeBusy(calendar-memoria.md D.2 = P4a)が未提供のため、Calliope 側で `listEvents + listPersonalEvents` を合成した近似実装から始め、P4b で Schedula 版 `/api/calendar/freebusy` に差し替える**(connector のインタフェースは同一に保ち、呼び出し側を変えない)。
- 予定化: 確定 entry(特に人間ゲート)を Schedula に event 作成(自律性境界に従う)。smart-scheduler の週次コマ割当は「1日内の細分配置」に流用可。

---

## 5. 能力B — 他プロジェクト優先度を加味した自動リスケ

### 5.1 トリガ(event + 周期)
| 種別 | 検知 |
|---|---|
| タスク追加/削除 | Actio webhook or polling、外部PM(将来) |
| 見積り/締切変更 | Actio task 更新 |
| velocity ドリフト | §2 実績が予測から乖離(実所要 > D̂ の p80 等) |
| 上位PJ割込み | 高 importance PJ に緊急タスク発生 |
| 依存追加 | DAG 変化 |
| 周期 | 日次ループ(§1) |

### 5.2 リスケ・アルゴリズム
```
onTrigger:
   refreshPriority(); refreshVelocity()
   newPlan = generatePlan(horizon)          # §4 を再実行
   diff = comparePlan(activePlan, newPlan)   # 移動/後ろ倒し/前倒しタスク
   risk = assessRisk(diff)                   # §5.3
   log(reschedule_log, before=activePlan, after=newPlan, trigger, risk)
   return proposal(diff, risk)
```

### 5.3 リスク判定(自律性境界の入力)
- **高リスク** → `human_confirmation_required`: いずれかの goal 締切がスリップ / 稼働中の他PJ作業を preempt / 人間ゲートの再配置。
- **低リスク** → auto-apply: 同一PJ内の順序変更のみ・締切影響なし・未着手範囲のみ。

### 5.4 クロスPJ調停(重要)
- 共有 AI 容量(C レーン)を優先度順に再配分。高 importance PJ が緊急割込み → 低 importance PJ タスクを後ろ倒し。
- **starvation ガード**: 低優先 PJ が永久後回しにならぬよう、(a)最低容量フロア(各アクティブ PJ に最低 x% レーン)or (b)aging(待ち時間で P(t) を逓増)。既定は aging(= §3.2 の w5 項。wait 起点は `priority.first_ready_at`)。
- 全リスケは `reschedule_log` に before/after と理由を残し可監査に。

---

## 6. 能力C — バグ収束/実装曲線を加味したスプリント自動設計・管理

### 6.1 スプリントの定義
- 期間(既定1-2週) + コミット済タスク集合 + 対象 goal/PJ。エンティティは Calliope `sprint` / `sprint_task`(Actio milestone は外部ミラーなので流用しない)。

### 6.2 3つの曲線(入力)
| 曲線 | ソース | 用途 |
|---|---|---|
| **バグ収束(Gompertz)** | **Actio PM `analytics/gompertz`** を流用(estimatedTotalBugs, convergenceDate, R²) | 残バグ工数を予測し容量から予約 |
| **タスク追加(inflow)** | Actio `pm_task_snapshots` の created 系列 → 流入率 λ(件/日) | スプリント中に増える見込み work を予約 |
| **実装 burn-down** | 完了系列 vs 計画 | 進捗逸脱の検知 |

### 6.3 スプリント自動設計
```
# 単位規約: 本節はすべて「見積り分(E単位)」で計算する。
# Θ_p = Σ E_t(完了)/日 は E単位の実効消化ペースで、見積り誤差(k_p)の影響を
# 既に織り込んでいる。scope 判定に D̂(=E·k_p)を使うと補正が二重になるため、使うのは E_t。
K = Θ_p · sprint_days                      # 素の容量(E単位)
reserve_bug  = expectedRemainingBugEffort(gompertz, window) / K   # バグ予約(E単位)
reserve_flow = λ · sprint_days · avgEffort / K                    # 流入予約(E単位)
K_eff = K · (1 - reserve_bug - reserve_flow)   # 予約控除後の実効容量
scope = []
for t in tasks sorted by P(t) desc, ready:      # §3 優先度順
    if Σ E(scope) + E_t ≤ K_eff: scope.push(t)
sprint = { period, scope, goal, target_velocity=Θ_p, gompertz_snapshot }
```
- 容量に**バグ予約と流入予約**を織り込むのが肝。楽観的に詰めず、収束予測と追加曲線で buffer を確保。
- **§4(能力A)との単位の橋**: C は「どれだけ積めるか(scope 量)」を E単位のスループットで決め、
  A は「いつ終わるか(日時)」を wall-clock(D̂ = E·k_p をレーンに配置)で決める。
  scope 選定 = E単位 / タイムライン配置 = D̂、と役割を分けることで両モデルは矛盾しない。

### 6.4 スプリント管理ループ(日次)
```
ingest: バグ found/fixed Δ(snapshots), task add/close Δ, velocity 実績
refit:  gompertz 再フィット, burn-down 更新, 残 forecast
judge:  projected_completion vs sprint_end
        - 遅延見込み → 提案: (a)最低優先スコープ削減 (b)期間延長 (c)容量追加(レーン増)
        - 収束が予測より速い → 次スコープを前倒し pull-in
health: 収束信頼度(R²), スコープ増加率(scope creep), velocity 分散
close/next: goal 達成 or 期限で close → 未完を繰越し、B の最新優先度で次スプリント自動設計
```

### 6.5 A/B との結合
- C がホライズン近傍の**スコープと期間**を決める → A がそのスコープを**タイムライン配置** → B が期中の変化に**再配置で反応**。
- スプリント境界の再設計時は B の最新 priority を、配置は A を、健全性は本節を使う(§1 のループ)。

---

## 7. データモデル追加(v0.1 §3 の詳細化)

`velocity`(§2.3), `priority`(§3.2), `sprint`/`sprint_task`(§6.1), `plan`/`plan_entry`(§4.1), `reschedule_log`(§5) に加え:
- `task_estimate`(task参照, E_t, estimate_source=human/analogy/llm, confidence, estimated_at) — §2.2 の推定結果を保持し実績で上書き学習。
- `curve_snapshot`(sprint参照, date, gompertz params, inflow λ, burndown 実績/計画) — §6 の日次曲線履歴。

---

## 8. エッジケース / ガード

- **cold-start**: velocity 実績不足時は見積りを広い信頼帯で使い「暫定計画」表示。apply は保守的(高リスク寄り)に倒す。
- **見積り欠損**: EstimationService 必須(§2.2)。未推定タスクをスケジュールに落とさない/落とすなら最低精度で明示。
- **starvation**: §5.4 aging。
- **循環依存**: DAG に閉路があれば検出し人間に通報(自動解決しない)。
- **過詰め防止**: §6.3 の予約。楽観見積りを常に buffer で割引。
- **破壊回避**: plan は supersede 版管理、reschedule は log 必須、Google/Schedula 書込は高リスク→確認。

---

## 9. 未決/要確認(この詳細設計での前提)

1. **見積りの主体**: 未見積りタスクを Calliope が推定(analogy→LLM)でよいか。人間/AI が Actio で見積る運用にするか。→ 既定: Calliope 推定 + 実績学習。
2. **並列容量 C の取得元**: 当面は設定値、将来 Concordia 実データ。→ 既定: 設定 `CALLIOPE_AGENT_LANES`。
3. **人間ゲートの定義**: どのタスク種別が neco の承認/レビューを要するか(設計承認・マージ判断等)。→ ラベル/種別でマーク、初期は「goal 承認」「PR マージ」を人間ゲート既定。所要は k_p 非適用の固定既定(30分、種別で上書き。§4.2)。
4. **スプリント長**: 既定1-2週。PJ ごとに可変にするか。
5. **優先度 weights**: roadmap 重視の初期値。neco が調整。

---

## 10. Codex 委託フェーズ(A/B/C 部分, 親 §10 の P1-P3 を具体化)

| Phase | 実装 | 依存 |
|---|---|---|
| **P1a** | Velocity モデル(§2) + EstimationService(§2.2) + `velocity`/`task_estimate` | P0(Connector基盤) |
| **P1b** | Priority モデル(§3) + `priority` | P0 |
| **P1c** | 能力A スケジューラ(§4) + `plan`/`plan_entry` + 近似 freeBusy(Calliope 側で events+personal_events 合成; §4.3。Schedula 版への差し替えは P4b) | P1a,P1b |
| **P2**  | 能力C スプリント設計/管理(§6) + gompertz/inflow 取込 + `sprint`/`curve_snapshot` | P1a-c |
| **P3**  | 能力B トリガ/リスケ/クロスPJ調停(§5) + `reschedule_log` + 自律性適用 | P1c,P2 |

full-set-implementation 準拠(MVPで削らず、配線・テストまで各 Phase 完結)。
