// drizzle migration 適用。`npm run db:generate` で生成した SQL を適用する。
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb } from './client.ts';

const dbPath = process.env.CALLIOPE_DB_PATH ?? './data/calliope.db';
const db = openDb(dbPath);
migrate(db, { migrationsFolder: './src/db/migrations' });
console.log(`[calliope] migrations applied to ${dbPath}`);
