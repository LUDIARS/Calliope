# Calliope 仕様レビュー — 2026-07-09

対象: `DESIGN.md` / `docs/design/scheduling.md` / `docs/design/calendar-memoria.md` / `docs/CODEX-P0.md`
方法: 4文書の内部整合 + P0 実装(`src/`)との突合。
結論: **骨格(SoT境界・自律性境界・フェーズ分割)は健全**。ただし設計判断が要る不整合が3件、仕様の穴が7件、文書整備が5件。

---

## A. 要判断(実装前に解消すべき不整合)

### A-1. §6.3 スプリント容量計算の単位不整合(scheduling.md)
- `Θ_p = Σ E_t(完了) / window_days` は**見積り分単位**のスループット(§2.3)。
- よって `K = Θ_p · sprint_days` も見積り分単位の容量。
- 一方 scope 判定は `Σ D̂(scope) ≤ K_eff` で、`D̂_t = E_t · k_p` は**実所要分単位**。
- k_p ≠ 1 のとき補正が二重(k_p>1 で過小 scope)または欠落し、単位が合わない。
- **修正案(いずれか)**:
  (a) scope 判定を `Σ E_t ≤ K_eff` にする — Θ_p が実効ペースを既に織り込んでいるため整合。
  (b) `K = C レーン × 稼働時間(wall-clock)` と定義し直し、`Σ D̂` と比較する。
  §4(能力A)はレーン×D̂ の wall-clock モデル、§6(能力C)は Θ のスループットモデルで、両者の橋渡しを明記しないと P2 実装がぶれる。

### A-2. freeBusy のフェーズ依存矛盾(scheduling.md §10 / calendar-memoria.md D)
- scheduling.md §10: **P1c** で「Schedula freeBusy 結線」(依存は P1a,P1b のみ)。
- calendar-memoria.md D.2/D.7: freeBusy エンドポイント自体は **P4a(Schedula 別PR)** で追加。
- → P1c 時点で結線先が存在しない。能力A の人間ゲート配置(§4.2/§4.3)は freeBusy 前提。
- CODEX-P0 T4 は「stub(501 or events から近似)+ TODO」を指定したが、実装 `src/clients/schedula.ts` には freeBusy が**メソッドごと存在しない**(`getScheduling` も同様)。
- **修正案**: P1c は「Calliope 側で `listEvents + listPersonalEvents` を合成した近似 freeBusy で開始し、P4b で Schedula 版 `/api/calendar/freebusy` へ差し替え」と明記。SchedulaConnector に近似 freeBusy を追加するタスクを P1c に含める。

### A-3. `calendar_link.google_calendar_id` と個人データ規約の衝突(DESIGN §3 / D.3)
- Google の **primary カレンダー ID はユーザの email アドレスそのもの**。
- [[project_personal_data_rule]] / CLAUDE.md「個人データ(name/email/token)を Calliope DB に保管しない」と矛盾しうる。
- **修正案**: `'primary'` エイリアス固定を既定にする、または Schedula 側で calendar 参照を管理し Calliope は Schedula の link id のみ保持する(所有権を Schedula に置く D.0 原則とも整合)。

## B. 仕様の穴(実装フェーズ到達前に定義追加)

| # | 箇所 | 内容 |
|---|---|---|
| B-1 | scheduling.md §3.2 | `urgency` の未定義ケース: due_at 無しタスクの値(0? 中立値?)と期限超過(days_to_due < 0)の扱い。超過は clamp で「本日期限」と同値になるが、超過日数で加点しないのか明記を。 |
| B-2 | scheduling.md §5.4 | aging を既定としながら §3.2 の P(t) 式に aging 項が無い。待機起点(ready になった時刻)をどこに永続化するかもデータモデル(§7 / DESIGN §3)に無い。式への項追加と保持先(`priority.breakdown` か新カラム)を定義。 |
| B-3 | DESIGN §6/§7 | 高リスク=`409 human_confirmation_required` だが、**人間が確認して適用するための API が無い**(§7 の一覧に confirm/force 系が無い)。Thaleia パターン踏襲なら「同一エンドポイントに `confirm: true` 再送」等を明記。 |
| B-4 | DESIGN §3 / CODEX-P0 T1 | `task_ref` の正規形式が不統一: plan_entry/sprint_task は JSON(source+id)、task_estimate/priority.ref は plain text。実装 `schema.ts` もそのまま混在。テーブル間 join・逆引き(task→estimate→plan_entry)のため正規文字列形(例 `actio:<id>` / `actio-pm:<externalId>`)を定義し統一すべき。 |
| B-5 | scheduling.md §4.2 | 人間ゲートの所要に `D̂_t 相当`(= AI velocity k_p 補正)を使うのは不適。人間の承認/レビュー時間は AI 実績と無関係。人間ゲート用の既定所要(固定値 or 種別別)を定義。 |
| B-6 | calendar-memoria.md D.4 | plan supersede 時、旧 plan_entry に紐づく Google イベント(calliope タグ付き)の update/delete セマンティクスが未定義。放置すると古い計画ブロックがカレンダーに残留。 |
| B-7 | scheduling.md §1 / calendar-memoria.md E.1 | 日次ループ 05:00 は Memoria goal_eval(毎朝 7:00)より**前** → 常に前日評価で計画する。意図的なら明記、そうでなければ実行時刻の調整 or eval 完了イベントでのトリガに。 |

## C. 文書整備(軽微)

- C-1: 分冊2点の親参照が `CALLIOPE-DESIGN-v0.1.md` のまま(実ファイルは `DESIGN.md`)。DESIGN.md 自体に版表記が無く、分冊は「詳細設計 v0.2」— 版管理の表記を揃える。
- C-2: CODEX-P0 T3 のパス例 `GET /api/pm/analytics/gompertz` と実装 `GET /api/pm/projects/:id/analytics/gompertz` が乖離。「要検証」の検証結果を仕様に反映して確定パスを記載(T4/T5 の要検証項目も同様に消し込み)。
- C-3: Calliope 自身の API 認証が未記載。上流への Bearer は規定済みだが、`POST /api/plan/generate` 等を誰が呼べるか(Cernere service token? 内部ネットワーク限定?)を §7 に追記。
- C-4: §2.3 cold-start「global 係数 or k=1 に shrink」の二択が未決。global 係数の算出元(全PJ横断 median?)含め既定を決める。
- C-5: `velocity.category` が実装で NOT NULL だが、PJ 全体(カテゴリ横断)の velocity 行の表現が未定義。spec は「PJ/カテゴリ」併記のみ。`'*'` 等の番兵か nullable かを決める。

## D. 良い点(維持すべき判断)

- **SoT 境界が一貫**: 「bind, don't reimplement」が D(Google 所有権を Schedula に据え置き)/ E(移管せず read バインド + 隙間3点)まで徹底され、DESIGN §2 の所在表と分冊の記述に矛盾がない。
- **自律性境界と監査**: 低/高リスクの2段 + reschedule_log 必須 + supersede 版管理が A/B/C/D 全能力で同じ語彙で規定されている。
- **エッジケース章(scheduling.md §8)**: cold-start / 循環依存 / 過詰め / starvation を先回りで規定。
- **P0 実装は CODEX-P0 にほぼ忠実**: 503 `<svc>_unconfigured` / 502 UpstreamError 写像(受け入れ基準どおり)、全テーブル drizzle 定義、Thaleia 準拠の `mount*Routes` パターン。乖離は freeBusy stub 欠落(A-2)と T3 パス表記(C-2)のみ。

## E. 対応状況(2026-07-09 同日・同PRで反映)

| 指摘 | 対応 |
|---|---|
| A-1 | ✔ scheduling.md §6.3 を E単位に統一(案(a)採用)+ §4 との単位の橋を明記 |
| A-2 | ✔ §4.3 / §10 P1c / CODEX-P0 T4 / calendar-memoria.md D.7 に「P1c=Calliope 側近似 freeBusy → P4b で差し替え」を明記(コードは P1c で実装) |
| A-3 | ✔ `calendar_ref`(`'primary'` or Schedula 参照 id)に変更。spec(D.3 / DESIGN §3 / CODEX-P0 T1)+ `schema.ts` + migration 0001 |
| B-1 | ✔ §3.2 urgency のケース定義(due 無し=0 / 超過=1 飽和 + overdue_days を breakdown 記録) |
| B-2 | ✔ §3.2 に w5·aging 項 + `priority.first_ready_at`(列追加は P1b) |
| B-3 | ✔ confirmations API(DESIGN §6/§7)+ pm-extensions.md F1 として具体化 |
| B-4 | ✔ 正規形 `actio:<taskId>` / `actio-pm:<projectId>/<externalId>` を DESIGN §3 で規定。`plan_entry`/`sprint_task` の task_ref を JSON→text に(schema.ts) |
| B-5 | ✔ §4.2 gate_minutes: k_p 非適用、既定30分・種別上書き |
| B-6 | ✔ D.4 に supersede 時の Google イベント後始末を規定 |
| B-7 | ✔ 日次ループを 07:30 へ(goal_eval 07:00 の後)。将来 event 駆動 |
| C-1 | ✔ 分冊の親参照を DESIGN.md に修正、改訂行を追加 |
| C-2 | ✔ CODEX-P0 T3/T4/T5 を as-built パスで確定、「要検証」を消し込み |
| C-3 | ✔ DESIGN §7 に認証(`CALLIOPE_SERVICE_TOKEN` Bearer、/health は公開)を追記 |
| C-4 | ✔ §2.3 ベイズ収縮式を確定(n_0=5, k_0=全PJ横断 median or 1) |
| C-5 | ✔ `category='*'` / `project_ref='*'` の番兵を規定 |
| 追加提案 | ✔ [`../design/pm-extensions.md`](../design/pm-extensions.md)(F1-F7: 承認キュー/ブリーフィング/What-if/リスク/精度/コスト/振り返り) |

## E'. 推奨アクション順(原文)

1. A-1(容量単位)と B-4(task_ref 正規形)を先に確定 — P1a/P1b のデータモデルに直結。
2. A-2 の freeBusy 近似方針を scheduling.md §10 P1c と CODEX-P0 T4 に反映。
3. A-3 の calendar_link 表現を D.3 / DESIGN §3 で修正(P4 まで猶予はあるがスキーマは P0 で作成済みのため早めに)。
4. B-1/B-2/B-3/B-5 を P1 着手前に scheduling.md へ追記。B-6/B-7 は P2/P4 前で可。
5. C 群は次回 spec 更新 PR でまとめて。
