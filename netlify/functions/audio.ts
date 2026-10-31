import { stream } from '@netlify/functions';
import { getDb } from '../../src/lib/db';
import { json } from './_shared/http';
import { getAudio } from './_shared/audioStore';
import { parseByteRange, sliceByteStream } from '../../src/lib/byte-range';

export const handler = stream(async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' } }, { Allow: 'GET' });
  const path = event.queryStringParameters?.path || '';
  const match = /^(.+)-([a-f0-9]{8})\.mp3$/.exec(path);
  if (!match) return json(404, { error: { code: 'NOT_FOUND', message: 'Audio not found.' } });
  const [, slug, hashPrefix] = match;
  const result = await getDb().execute({
    sql: `SELECT a.blob_key,a.byte_size FROM audio a JOIN posts p ON p.id=a.post_id
      WHERE p.slug=? AND p.status='published' AND a.status='ready' AND substr(a.content_hash,1,8)=? LIMIT 1`,
    args: [slug, hashPrefix],
  });
  const row = result.rows[0];
  const key = row?.['blob_key'] ? String(row['blob_key']) : '';
  const size = Number(row?.['byte_size']);
  if (!key || !Number.isSafeInteger(size) || size <= 0) return json(404, { error: { code: 'NOT_FOUND', message: 'Audio not found.' } });
  const range = parseByteRange(event.headers.range, size);
  if (range === false) {
    return { statusCode: 416, headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }, body: '' };
  }
  const audio = await getAudio(key);
  if (!audio) return json(404, { error: { code: 'NOT_FOUND', message: 'Audio file not found.' } });
  const headers = {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(range ? range.end - range.start + 1 : size),
  };
  if (!range) return { statusCode: 200, headers, body: audio };
  return {
    statusCode: 206,
    headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}` },
    body: sliceByteStream(audio, range.start, range.end),
  };
});
