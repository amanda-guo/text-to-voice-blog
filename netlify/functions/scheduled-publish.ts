import type { Handler } from '@netlify/functions';
import { getDb } from '../../src/lib/db';
import { beginPublishing } from './_shared/publish';

export const handler: Handler = async () => {
  const db = getDb();
  const due = await db.execute({
    sql: `SELECT id FROM posts WHERE status='scheduled' AND publish_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY publish_at LIMIT 50`,
  });
  for (const row of due.rows) {
    const id = Number(row['id']);
    const claimed = await db.execute({
      sql: `UPDATE posts SET status='draft' WHERE id=? AND status='scheduled' AND publish_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      args: [id],
    });
    if (Number(claimed.rowsAffected) === 0) continue;
    try { await beginPublishing(id); } catch (error) {
      await db.execute({
        sql: `UPDATE posts SET status='draft' WHERE id=? AND status IN ('draft','publishing')`,
        args: [id],
      });
      console.error(`Scheduled publication failed for post ${id}.`);
    }
  }
  return { statusCode: 200, body: JSON.stringify({ processed: due.rows.length }) };
};
