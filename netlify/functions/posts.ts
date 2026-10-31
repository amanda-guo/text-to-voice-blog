import type { Handler } from '@netlify/functions';
import { getDb } from '../../src/lib/db';
import { isAuthenticated } from './_shared/auth';
import { json, originIsTrusted, parseBody } from './_shared/http';
import { postInput, postWithTags, savePost } from './_shared/posts';
import { triggerBuild } from './_shared/publish';
import { z } from 'zod';

export const handler: Handler = async (event) => {
  if (!(await isAuthenticated(event.headers.cookie))) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in to manage posts.' } });
  const db = getDb();
  if (event.httpMethod === 'GET') {
    const id = Number(event.queryStringParameters?.id);
    if (id) {
      const post = await postWithTags(id);
      return post ? json(200, { post }) : json(404, { error: { code: 'NOT_FOUND', message: 'Post not found.' } });
    }
    const status = event.queryStringParameters?.status;
    const result = await db.execute({
      sql: `SELECT id,title,status,updated_at FROM posts ${status ? 'WHERE status=?' : ''} ORDER BY updated_at DESC LIMIT 200`,
      args: status ? [status] : [],
    });
    const posts = await Promise.all(result.rows.map(async (row) => {
      return postWithTags(Number(row['id']));
    }));
    return json(200, { posts });
  }
  if (!originIsTrusted(event)) return json(403, { error: { code: 'BAD_ORIGIN', message: 'Request origin is not allowed.' } });
  try {
    if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
      const parsed = postInput.parse(parseBody(event));
      const old = event.httpMethod === 'PUT' && parsed.id
        ? await db.execute({ sql: 'SELECT status FROM posts WHERE id=?', args: [parsed.id] })
        : undefined;
      const post = await savePost(parsed, event.httpMethod === 'POST');
      const saved = await postWithTags(Number(post?.['id']));
      if (String(old?.rows[0]?.['status'] || '') === 'published' && event.queryStringParameters?.rebuild === '1') {
        try {
          await triggerBuild();
          return json(event.httpMethod === 'POST' ? 201 : 200, { post: saved });
        } catch {
          return json(200, { post: saved, warning: 'Saved, but the static-site rebuild could not be started. Check NETLIFY_BUILD_HOOK_URL.' });
        }
      }
      return json(event.httpMethod === 'POST' ? 201 : 200, { post: saved });
    }
    if (event.httpMethod === 'DELETE') {
      const id = z.coerce.number().int().positive().parse(event.queryStringParameters?.id);
      await db.execute({ sql: "UPDATE posts SET status='archived',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", args: [id] });
      return json(200, { ok: true });
    }
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } }, { Allow: 'GET, POST, PUT, DELETE' });
  } catch (error) {
    if (error instanceof z.ZodError) return json(400, { error: { code: 'INVALID_INPUT', message: error.issues[0]?.message || 'Invalid post data.' } });
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) return json(409, { error: { code: 'SLUG_EXISTS', message: 'That slug is already in use.' } });
    if (error instanceof Error && error.message === 'Post not found.') return json(404, { error: { code: 'NOT_FOUND', message: error.message } });
    return json(500, { error: { code: 'POST_SAVE_FAILED', message: error instanceof Error ? error.message : 'Unable to save the post.' } });
  }
};
