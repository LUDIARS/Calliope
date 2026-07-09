import type { Config } from 'drizzle-kit';

// Calliope は計画成果物のみを自 DB(SQLite)に持つ。task/event/goal は各サービスが正本。
// 将来 PostgreSQL へ寄せる場合は Actio の dialects 実装を参照(現状は SQLite 単一)。
export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.CALLIOPE_DB_PATH ?? './data/calliope.db',
  },
} satisfies Config;
