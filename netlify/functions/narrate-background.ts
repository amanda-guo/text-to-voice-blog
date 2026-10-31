import type { Handler } from '@netlify/functions';
import { parseBuffer } from 'music-metadata';
import { timingSafeEqual } from 'node:crypto';
import { getDb } from '../../src/lib/db';
import { config } from '../../src/lib/config';
import { contentHash, narrationText, splitNarration } from '../../src/lib/tts-text';
import { signJob, triggerBuild } from './_shared/publish';
import { putAudio } from './_shared/audioStore';
import { json, parseBody } from './_shared/http';

type Job = { postId: number; timestamp: number; signature: string };
const MAX_ATTEMPTS = 4;

function isValidJob(job: Job): boolean {
  if (!Number.isInteger(job.postId) || Math.abs(Date.now() - job.timestamp) > 5 * 60_000) return false;
  const expected = Buffer.from(signJob(job.postId, job.timestamp), 'hex');
  const received = Buffer.from(job.signature || '', 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function mockAudio(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: 20 }, () => frame));
}

function stripId3Tag(buffer: Buffer): Buffer {
  if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'ID3') return buffer;
  const size = ((buffer[6]! & 0x7f) << 21) | ((buffer[7]! & 0x7f) << 14) | ((buffer[8]! & 0x7f) << 7) | (buffer[9]! & 0x7f);
  const end = Math.min(buffer.length, 10 + size + ((buffer[5]! & 0x10) ? 10 : 0));
  return buffer.subarray(end);
}

async function synthesize(chunk: string, voiceId: string, modelId: string, previousText: string, nextText: string): Promise<Buffer> {
  if (process.env.ELEVENLABS_MOCK === '1') return mockAudio();
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured.');
  const baseUrl = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, '');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: chunk,
          model_id: modelId,
          voice_settings: config.audio.settings,
          ...(previousText ? { previous_text: previousText } : {}),
          ...(nextText ? { next_text: nextText } : {}),
        }),
      });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
      continue;
    }
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS - 1) throw new Error(`ElevenLabs returned HTTP ${response.status}.`);
    const retryAfter = Number(response.headers.get('retry-after'));
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 2 ** attempt * 1000));
  }
  throw new Error('Narration failed after retries.');
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, { Allow: 'POST' });
  let job: Job;
  try { job = parseBody(event) as Job; } catch { return json(400, { error: { code: 'INVALID_JOB', message: 'Invalid narration job.' } }); }
  try {
    if (!isValidJob(job)) return json(403, { error: { code: 'INVALID_JOB', message: 'Narration job authorization failed.' } });
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT p.id,p.title,p.body_md,p.narration_override,p.status,a.content_hash,a.voice_id,a.model_id
        FROM posts p JOIN audio a ON a.post_id=p.id
        WHERE p.id=? AND a.status='queued' ORDER BY a.created_at DESC LIMIT 1`,
      args: [job.postId],
    });
    if (!result.rows[0]) return json(404, { error: { code: 'JOB_NOT_FOUND', message: 'Queued narration was not found.' } });
    const row = result.rows[0] as unknown as {
      id: number; title: string; body_md: string; narration_override: string | null;
      content_hash: string; voice_id: string; model_id: string;
    };
    const text = narrationText(row.title, config.author, row.body_md, row.narration_override);
    if (text.length > 40_000 || contentHash(text, row.voice_id, row.model_id, config.audio.settings) !== row.content_hash) {
      throw new Error('The saved post text no longer matches this narration job.');
    }
    const chunks = splitNarration(text);
    const claimed = await db.execute({
      sql: "UPDATE audio SET status='generating',error=NULL WHERE post_id=? AND content_hash=? AND status='queued'",
      args: [job.postId, row.content_hash],
    });
    if (Number(claimed.rowsAffected) === 0) return json(202, { status: 'already-processing' });
    const parts: Buffer[] = [];
    for (let i = 0; i < chunks.length; i++) {
      parts.push(stripId3Tag(await synthesize(chunks[i]!, row.voice_id, row.model_id, chunks[i - 1] || '', chunks[i + 1] || '')));
    }
    const audio = Buffer.concat(parts);
    const metadata = await parseBuffer(audio, 'audio/mpeg').catch(() => undefined);
    const duration = Math.max(1, Math.round(metadata?.format.duration || (audio.byteLength * 8 / 128_000)));
    const key = `audio/${job.postId}/${row.content_hash}.mp3`;
    const audioArrayBuffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
    await putAudio(key, audioArrayBuffer);
    await db.execute({
      sql: `UPDATE audio SET status='ready',blob_key=?,duration_sec=?,byte_size=?,error=NULL WHERE post_id=? AND content_hash=?`,
      args: [key, duration, audio.byteLength, job.postId, row.content_hash],
    });
    await db.execute({
      sql: `UPDATE posts SET status='published',published_at=COALESCE(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      args: [job.postId],
    });
    try { await triggerBuild(); } catch (error) {
      await db.execute({
        sql: `UPDATE audio SET error=? WHERE post_id=? AND content_hash=?`,
        args: [error instanceof Error ? error.message : 'Build hook failed.', job.postId, row.content_hash],
      });
    }
    return json(200, { ok: true, chunks: chunks.length, duration });
  } catch (error) {
    try {
      const current = parseBody(event) as Job;
      const db = getDb();
      const row = await db.execute({ sql: `SELECT content_hash FROM audio WHERE post_id=? AND status IN ('queued','generating') ORDER BY created_at DESC LIMIT 1`, args: [current.postId] });
      if (row.rows[0]) await db.execute({
        sql: `UPDATE audio SET status='failed',error=? WHERE post_id=? AND content_hash=?`,
        args: [error instanceof Error ? error.message.slice(0, 500) : 'Narration failed.', current.postId, String(row.rows[0]['content_hash'])],
      });
      await db.execute({ sql: "UPDATE posts SET status='draft' WHERE id=? AND status='publishing'", args: [current.postId] });
    } catch {
      return json(500, { error: { code: 'NARRATION_CLEANUP_FAILED', message: 'Narration failed and its status could not be updated. Check the post status before retrying.' } });
    }
    return json(500, { error: { code: 'NARRATION_FAILED', message: error instanceof Error ? error.message : 'Narration failed.' } });
  }
};
