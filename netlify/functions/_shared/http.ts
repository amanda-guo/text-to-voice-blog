import type { HandlerEvent, HandlerResponse } from '@netlify/functions';

export function json(statusCode: number, data: unknown, headers: Record<string, string> = {}): HandlerResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify(data),
  };
}

export function parseBody(event: HandlerEvent): unknown {
  if (!event.body) return {};
  try { return JSON.parse(event.body); } catch { throw new Error('Request body must be valid JSON.'); }
}

export function originIsTrusted(event: HandlerEvent): boolean {
  const origin = event.headers.origin;
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (event.headers.host && url.host === event.headers.host) return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const allowed = [process.env.SITE_URL, process.env.URL, process.env.DEPLOY_PRIME_URL]
      .filter((value): value is string => Boolean(value));
    return allowed.some((value) => url.origin === new URL(value).origin);
  }
  catch { return false; }
}

export function clientIp(event: HandlerEvent): string {
  return event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
}
