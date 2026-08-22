# Calliope データスキーマ

Calliope は計画成果物だけをローカル SQLite に保持する。タスク・目標・予定・個人属性の正本は上流サービスであり、本文や個人データを複製しない。

| データ | 種類 | 権威ソース | 保存先 | 保護要否 | 保護方法 |
|---|---|---|---|---|---|
| plan / plan_entry | user | Calliope | SQLite | 要 | service tokenでAPIを保護。task_refのみ保存し、タイトル・氏名・emailを保存しない |
| sprint / sprint_task | user | Calliope | SQLite | 要 | task_ref、commit時effort/priority、状態履歴のみ。本文や担当者を保存しない |
| velocity / task_estimate | user | Calliope | SQLite | 要 | project/category/task_refと集計値のみ。agent prompt/logを保存しない |
| priority | user | Calliope | SQLite | 要 | project/goal/task ref、合成値、first_ready_atのみ。上流本文を保存しない |
| reschedule_log | user | Calliope | SQLite | 要 | plan差分は参照・計画枠のみに限定し、API認証下で提供 |
| confirmation | user | Calliope | SQLite | 要 | task_ref/plan idとdiff/riskのみ。24h expiry、裁定者は非個人aliasのみ |
| curve_snapshot | user | Calliope | SQLite | 要 | sprint参照と集計曲線のみ |
| goal_risk_snapshot | user | Calliope | SQLite | 要 | goal_ref、日次予測・deadline・risk要因の集計値のみ |
| connector_state | master | Calliope | SQLite | 不要 | service名・health・cursorのみ。tokenやerror本文を保存しない |
| service_map_pc / service_map_domain / service_map_group | master | Calliope | SQLite | 不要 | 家PCスペック・事業ドメイン・グループの台帳。個人データなし |
| service_map_service | master | Excubitor catalog | SQLite | 不要 | catalog同期スナップショット+割当(groupIds/pcIds)。ポートは CF 認証済み full API のみで返す |
| service_map_roadmap | user | Calliope | SQLite | 不要 | ドメイン別ロードマップ生成物 (supersede版管理)。repo名・importance・優先度集計のみ |
| calendar_link | user | Schedula | SQLite参照 | 要 | calendar_refは primary aliasまたはSchedula参照IDのみ。生Google calendar ID/emailを保存しない |
| task / goal | master | Actio | 非保存（task_ref参照のみ） | 要 | Bearer付きread。Calliope DBへ本文を複製しない |
| event / personal event | user | Schedula | 非保存（freeBusyへ一時変換） | 要 | 時刻区間だけをメモリ上で合成し、個人属性を保存しない |
| roadmap / goal_eval / agent_runs | user | Memoria | 非保存（集計入力のみ） | 要 | importance・目標状態・実行時間だけを集計し、title/path/prompt/log/summaryを保存しない |
| service token / upstream token | secret | Cernere / 実行環境 | DB非保存 | 要 | env注入。ソース・ログ・error本文へ出さない |

## 保持と更新

- plan は破壊更新せず、active切替時に旧planを superseded として保持する。
- velocity は同一の project_ref/category/window_start/window_end の再計算だけを置換し、window世代を保持する。
- priority.first_ready_at は初回ready時刻を保持し、再計算で上書きしない。
- sprint_taskはcommit時の見積りとpriorityをsnapshotとして保持し、日次更新は状態履歴へ追記する。
- curve_snapshotとgoal_risk_snapshotは参照+日付で一意。同日再計算はupsertし、過去日を破壊しない。
- active sprintはprojectごとに1件。closeは次planned sprintの生成成功後に行う。
- confirmationとhigh-risk proposal logは同一transactionで作成し、approve時はactive再検証後にplan/裁定/logを同一transactionで更新する。
- reschedule_log.outcomeはproposed/applied/rejected/expiredを保持し、履歴行を削除しない。
- 個人データの削除・opt-outは各正本サービスが担い、Calliopeには削除対象となる個人属性を置かない。
