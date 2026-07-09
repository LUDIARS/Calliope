// 自 DB(SQLite)接続。計画成果物のみを保持する。
// task/event/goal は各サービスが正本なので、ここには置かない。

import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import * as schema from './schema.ts';

export function openDb(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export type CalliopeDb = ReturnType<typeof openDb>;
