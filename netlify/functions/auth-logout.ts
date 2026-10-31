import type { Handler } from '@netlify/functions';
import { clearSessionCookie } from './_shared/auth';
import { json, originIsTrusted } from './_shared/http';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, { Allow: 'POST' });
  if (!originIsTrusted(event)) return json(403, { error: { code: 'BAD_ORIGIN', message: 'Request origin is not allowed.' } });
  return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
};
