// Calliope 自 DB スキーマ(計画成果物のみ)。
//
// このファイルは P0 の seed。全テーブルの定義は Codex 委託(docs/CODEX-P0.md §schema)で
// DESIGN.md §3 に従い実装する:
//   plan / plan_entry / sprint / sprint_task / velocity / task_estimate /
//   reschedule_log / priority / curve_snapshot / calendar_link
//
// 個人データ(name/email/token)は保持しない。task/event/goal は id 参照のみ。
// 破壊更新はせず supersede で版管理する(plan.status = draft/active/superseded)。

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// seed: 上流コネクタの health / 同期カーソルを保持(P0 で使う唯一の実テーブル)。
export const connectorState = sqliteTable('connector_state', {
  service: text('service').primaryKey(), // 'actio' | 'schedula' | 'memoria'
  health: text('health').notNull().default('unknown'), // 'ok' | 'degraded' | 'down' | 'unknown'
  lastSyncAt: text('last_sync_at'),
  cursor: text('cursor'), // 増分同期カーソル(syncToken 等)
  updatedAt: text('updated_at').notNull(),
});

// TODO(Codex P0): 上記コメントの残りテーブルを DESIGN.md §3 / docs/design/ に従い追加。
