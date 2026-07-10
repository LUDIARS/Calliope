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
| contract | upstream clients | 実path、Bearer、非2xx、Zod response shape |
| integration | routes | 未設定503、上流502、service token 401、health公開 |
| integration | plan lifecycle | generate→draft→apply→active→旧active supersede、reschedule_log transaction |
| migration | SQLite | 0000〜最新の初回適用と再適用、nullable/新カラムの実schema |

## 重要経路

1. estimate/velocity/priorityを更新する。
2. 未完タスクDAGをplanへ変換する。
3. 未見積りとSchedula未設定を警告として明示する。
4. planをapplyし、旧activeをsupersedeして監査logを同一transactionで残す。

異常系は正常系と同じPRで追加する。特に認証不一致、上流未設定/非2xx/契約違反、循環依存、未見積り、非draft applyを回帰対象とする。
