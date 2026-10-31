import { stream } from '@netlify/functions';
import { getImage } from './_shared/imageStore';
import { json } from './_shared/http';

const contentTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

export const handler = stream(async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or HEAD.' } }, { Allow: 'GET, HEAD' });
  const path = event.queryStringParameters?.path || '';
  const match = /^([a-f0-9-]{36})\.(jpg|png|webp|avif)$/.exec(path);
  if (!match) return json(404, { error: { code: 'NOT_FOUND', message: 'Image not found.' } });
  const [, id, extension] = match;
  const image = await getImage(`${id}.${extension}`);
  if (!image) return json(404, { error: { code: 'NOT_FOUND', message: 'Image not found.' } });
  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentTypes[extension!]!,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
    body: event.httpMethod === 'HEAD' ? '' : image.data,
  };
});
