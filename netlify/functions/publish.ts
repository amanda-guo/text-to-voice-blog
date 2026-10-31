import type { Handler } from '@netlify/functions';
import { z } from 'zod';
import { getDb } from '../../src/lib/db';
import { isAuthenticated } from './_shared/auth';
import { json, originIsTrusted, parseBody } from './_shared/http';
import { beginPublishing, validatePostForPublishing } from './_shared/publish';

const requestSchema = z.object({
  postId: z.coerce.number().int().positive(),
  withoutAudio: z.boolean().optional(),
  publishAt: z.string().datetime({ offset: true }).optional(),
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, { Allow: 'POST' });
  if (!(await isAuthenticated(event.headers.cookie))) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in to publish posts.' } });
  if (!originIsTrusted(event)) return json(403, { error: { code: 'BAD_ORIGIN', message: 'Request origin is not allowed.' } });
  try {
    const input = requestSchema.parse(parseBody(event));
    if (input.publishAt) {
      if (new Date(input.publishAt).getTime() <= Date.now()) {
        return json(400, { error: { code: 'INVALID_SCHEDULE', message: 'Choose a future publication time.' } });
      }
      await validatePostForPublishing(input.postId);
      const db = getDb();
      const updated = await db.execute({
        sql: `UPDATE posts SET publish_at=?,status='scheduled' WHERE id=?`,
        args: [input.publishAt, input.postId],
      });
      if (Number(updated.rowsAffected) === 0) return json(404, { error: { code: 'NOT_FOUND', message: 'Post not found.' } });
    }
    const status = input.publishAt ? 'scheduled' : await beginPublishing(input.postId, input.withoutAudio);
    return json(202, { status });
  } catch (error) {
    if (error instanceof z.ZodError) return json(400, { error: { code: 'INVALID_INPUT', message: error.issues[0]?.message || 'Invalid publish request.' } });
    const message = error instanceof Error ? error.message : 'Unable to publish this post.';
    const status = message === 'Post not found.' ? 404 : 400;
    return json(status, { error: { code: status === 404 ? 'NOT_FOUND' : 'PUBLISH_FAILED', message } });
  }
};
