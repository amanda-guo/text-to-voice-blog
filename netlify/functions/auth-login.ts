import type { Handler } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import { getDb } from '../../src/lib/db';
import { clientIp, json, originIsTrusted, parseBody } from './_shared/http';
import { createSession, hashIp, sessionCookie } from './_shared/auth';
import { z } from 'zod';

const credentials = z.object({ password: z.string().min(1).max(1024) });
const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 5;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, { Allow: 'POST' });
  if (!originIsTrusted(event)) return json(403, { error: { code: 'BAD_ORIGIN', message: 'Request origin is not allowed.' } });
  let input;
  try { input = credentials.parse(parseBody(event)); } catch {
    return json(400, { error: { code: 'INVALID_INPUT', message: 'Enter a valid password.' } });
  }
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) return json(503, { error: { code: 'ADMIN_NOT_CONFIGURED', message: 'Admin login is not configured.' } });
  try {
    const ipHash = hashIp(clientIp(event));
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO login_attempts (ip_hash,attempts,window_started_at) VALUES (?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT(ip_hash) DO UPDATE SET
        attempts=CASE WHEN julianday(window_started_at) < julianday('now', ?) THEN 1 ELSE attempts+1 END,
        window_started_at=CASE WHEN julianday(window_started_at) < julianday('now', ?) THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE window_started_at END`,
      args: [ipHash, `-${WINDOW_MINUTES} minutes`, `-${WINDOW_MINUTES} minutes`],
    });
    const attempts = await db.execute({ sql: 'SELECT attempts FROM login_attempts WHERE ip_hash=?', args: [ipHash] });
    if (Number(attempts.rows[0]?.attempts || 0) > MAX_ATTEMPTS) {
      return json(429, { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in 15 minutes.' } }, { 'Retry-After': String(WINDOW_MINUTES * 60) });
    }
    if (!(await bcrypt.compare(input.password, hash))) {
      return json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'The password was not accepted.' } });
    }
    await db.execute({ sql: 'DELETE FROM login_attempts WHERE ip_hash=?', args: [ipHash] });
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(await createSession()) });
  } catch {
    return json(500, { error: { code: 'LOGIN_FAILED', message: 'Unable to sign in right now.' } });
  }
};
