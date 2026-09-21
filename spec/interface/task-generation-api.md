# タスク自動生成 API

`docs/design/task-lifecycle.md` §G2 の HTTP 境界。機能仕様は
`spec/feature/task-generation.md`、実装は `src/routes/generate.ts` と
`src/routes/confirmations.ts`。

## 認証 / CORS

- `/api/*` は `CALLIOPE_SERVICE_TOKEN` の Bearer 認証下にある
  (未設定時は開発用にスキップし、起動警告を出す)。
- CORS は経路ごとに決める (`src/routes/cors.ts` の `resolveCorsOrigin`)。
  同じ origin に認可条件の違う 3 種類の面が載っているため、1 本の方針では足りない。
  - `/api/*` は既定で CORS を**付けない**。ダッシュボードは同一オリジン配信であり、
    confirmation approve / reschedule / calendar write といった副作用を持つため、
    ワイルドカード許可はしない。クロスオリジン利用は `CALLIOPE_CORS_ORIGINS`
    (カンマ区切り allowlist) で明示的に opt-in する。allowlist に無いオリジンには
    CORS ヘッダを返さない。
  - `/service-map` は allowlist に載ったオリジンからも**常に不許可**。
    未認証で変更できる admin 面を含む
    (`spec/plan/problem_logs/2026-08-23-service-map-exposure-and-import-collision.md`)。
  - それ以外 (`/health`・ダッシュボード資産) は従来どおり許可する。

## POST /api/tasks/generate

候補検出を on-demand で実行し、候補があれば `task_create` confirmation を 1 件作る。

- リクエストボディなし。
- 200 レスポンス:

```json
{
  "report": {
    "generatedAt": "2026-08-04T00:00:00.000Z",
    "candidates": [
      {
        "key": "risk_red|goal:memoria:12",
        "source": "risk_red",
        "title": "Risk mitigation for goal:memoria:12",
        "externalId": "calliope-taskgen-risk-red-goal-memoria-12",
        "originTaskRef": null,
        "projectRef": null,
        "goalRef": "goal:memoria:12",
        "category": null,
        "dueAt": "2026-08-20T09:00:00+09:00",
        "reason": "goal risk is red on 2026-08-04: projected 2026-08-28 vs deadline 2026-08-20"
      }
    ],
    "suppressed": [
      { "key": "plan_gap|task:actio:41", "source": "plan_gap", "reason": "existing_task_ref" }
    ],
    "summary": {
      "sprintCarryover": 0,
      "riskRed": 1,
      "planGap": 0,
      "retrospectiveAction": 0,
      "candidates": 1,
      "suppressed": 1
    }
  },
  "confirmation": { "id": "<uuid>", "kind": "task_create", "expiresAt": "<+24h ISO>" },
  "warnings": []
}
```

- 候補 0 件のときは `confirmation: null` を返す (confirmation を作らない)。
- `warnings` には読めなかった既存 payload 等 (`invalid_task_create_payload:<id>`)
  を入れる。黙って捨てない。
- 候補一覧の read API は増やさない。生成済み候補は
  `GET /api/confirmations?status=pending` に載る。

## POST /api/confirmations/:id (kind: task_create)

Decision Inbox の裁定。`{ "decision": "approve" | "reject", "reason"?, "decidedBy"?: "human" }`。
service token は個人を識別しないため、監査欄には固定の非個人 alias `human` だけを保存する。

- `approve`: payload の候補を Actio へ `createTask` し、
  `{ confirmation, result: { outcomes: [{ key, source, status: "created", taskId, taskRef, title }] } }`
  を返す。結果は confirmation payload へ追記される。
- `reject`: `reason` 必須 (未指定は 400 `invalid_request`)。
- Actio へ送る本文は
  `external_id` / `title` / `details` (`[calliope:<source>] <reason>`) /
  `status: "open"` / `due_at` / `kind: "task"` / `category` / `creator_type: "ai"`。
  `external_id` は候補 key からの決定的導出なので、再実行しても冪等。

## エラー写像

| 状況 | ステータス | ボディ |
|---|---|---|
| リクエスト不正 (reject の reason 欠落等) | 400 | `{ "error": "invalid_request", "issues": [...] }` |
| confirmation が存在しない | 404 | `{ "error": "confirmation_not_found" }` |
| pending でない | 409 | `{ "error": "confirmation_not_pending", "status": "<status>" }` |
| 24h TTL 切れ (`task_create` は自動再提案しない) | 409 | `{ "error": "confirmation_expired" }` |
| payload がスキーマ不一致 | 500 | `{ "error": "invalid_confirmation_payload" }` |
| Actio 未設定 | 503 | `{ "error": "actio_unconfigured", "hint": "..." }` |
| Actio の 4xx/5xx | 502 | `{ "error": "upstream_error", "service", "path", "status", "message" }` |
| Actio 応答が契約不一致 | 502 | `{ "error": "upstream_contract_error", "issues": [...] }` |

上流失敗は握り潰さない。mock へのフォールバックもしない。
