import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDb } from '../src/lib/db';

const db = getDb();
const migrationsDir = resolve('migrations');
await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`);
const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
for (const file of files) {
  const found = await db.execute({ sql: 'SELECT version FROM schema_migrations WHERE version=?', args: [file] });
  if (found.rows.length) continue;
  const sql = await readFile(resolve(migrationsDir, file), 'utf8');
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    if (/^CREATE TABLE IF NOT EXISTS schema_migrations/i.test(statement)) continue;
    await db.execute(statement);
  }
  await db.execute({ sql: 'INSERT INTO schema_migrations (version) VALUES (?)', args: [file] });
  console.log(`Applied migration ${file}`);
}
await db.close();
