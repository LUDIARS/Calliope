# Calliope テスト計画

Calliope の品質基準は「上流を二重実装せず、同じ入力から決定的な計画を作り、認証・失敗境界・版管理を崩さないこと」。

## 必須テスト

| 種類 | 対象 | 守る契約 |
|---|---|---|
| unit | task_ref | canonical生成・parse・不正形式拒否 |
| unit | velocity / accuracy | median、ベイズ収縮、番兵行、IQR、source別MAPE/bias |
| unit | estimation | analogy 3件閾値・median・confidence、LLM出力契約とtimeout runner |
| unit | priority | dueなし/通常/超過、aging上限、override固定 |
| unit | DAG / freeBusy / scheduler | topo順、閉路、区間merge、JST営業時間、依存順・Cレーン・human-pending |
| unit | sprint capacity / inflow | bug/inflow予約、ready/priority scope、過容量、28日λ、平均effort |
| unit | goal risk | p50/p80境界のgreen/amber/red、IQRからのp80外挿 |
| unit | reschedule diff/risk | added/removed/moved、deadline slip、running cross-PJ、人間gate |
| unit | daily orchestration | 07:30 JST、日跨ぎ、timer停止 |
| contract | upstream clients | 実path、Bearer、非2xx、Zod response shape |
| integration | routes | 未設定503、上流502、service token 401、health公開 |
| integration | plan lifecycle | generate→draft、計画horizon超過除外、apply→active→旧active supersede、reschedule_log transaction |
| integration | sprint lifecycle / risk | create→activate→goal_eval取込→replan→curve/risk upsert→close→next planned、red遷移通知要求 |
| integration | P3 autonomy | low-risk auto apply、高リスク409→approve、reject reason、非個人裁定alias、expiry/stale、What-if無書込 |
| integration | P4 calendar | freeBusy contract、calendar_write confirmation、opaque calendar_ref伝播、opaque tag、event ID persistence、supersede reuse、explicit degrade |
| integration | P5 dashboard/F7 | CSP/assets、weekly metrics/recommendations、Nuntius contract/skip、Monday timer cleanup |
| migration | SQLite | 0000〜最新の初回適用と再適用、nullable/新カラムの実schema |

## 重要経路

1. estimate/velocity/priorityを更新する。
2. 未完タスクDAGをplanへ変換する。
3. 未見積りとSchedula未設定を警告として明示する。
4. planをapplyし、旧activeをsupersedeして監査logを同一transactionで残す。
5. sprint容量からbug/inflow予約を控除し、日次replanでburndown・提案・F4 riskを履歴化する。

異常系は正常系と同じPRで追加する。特に認証不一致、上流未設定/非2xx/契約違反、循環依存、未見積り、非draft applyを回帰対象とする。
