import { createHmac } from 'node:crypto';
import { getDb } from '../../../src/lib/db';
import { config } from '../../../src/lib/config';
import { contentHash, narrationText } from '../../../src/lib/tts-text';
import { postWithTags } from './posts';

export function signJob(postId: number, timestamp: number): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  return createHmac('sha256', secret).update(`${postId}:${timestamp}`).digest('hex');
}

type PublishablePost = {
  id: number;
  title: string;
  body_md: string;
  narration_override: string | null;
  status: string;
  hero_image_url: string | null;
  hero_image_alt: string | null;
};

function validatePost(post: PublishablePost, withAudio: boolean): string {
  if (post.status === 'archived') throw new Error('Archived posts cannot be published.');
  if (!post.title.trim() || !post.body_md.trim()) throw new Error('A title and body are required before publishing.');
  if (post.hero_image_url && !post.hero_image_alt?.trim()) throw new Error('Hero images need descriptive alt text.');
  if (/!\[\s*\]\([^)]+\)/.test(post.body_md) || /<img\b(?![^>]*\balt\s*=)[^>]*>/i.test(post.body_md) || /<img\b[^>]*\balt\s*=\s*["']\s*["']/i.test(post.body_md)) {
      throw new Error('Every post image needs descriptive alt text.');
  }
  if (!withAudio) return '';
  if (!config.audio.voiceId) throw new Error('Set ELEVENLABS_VOICE_ID before publishing with narration.');
  const text = narrationText(post.title, config.author, post.body_md, post.narration_override);
  if (text.length > 40_000) throw new Error('Narration text exceeds the 40,000 character limit.');
  return text;
}

export async function validatePostForPublishing(postId: number): Promise<void> {
  const post = await postWithTags(postId);
  if (!post) throw new Error('Post not found.');
  validatePost(post as unknown as PublishablePost, true);
}

export async function beginPublishing(postId: number, noAudio = false): Promise<'queued' | 'published'> {
  const db = getDb();
  const post = await postWithTags(postId);
  if (!post) throw new Error('Post not found.');
  const typedPost = post as unknown as PublishablePost;
  const text = validatePost(typedPost, !noAudio);
  if (noAudio) {
      await db.execute({ sql: `UPDATE posts SET status='published',published_at=COALESCE(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?`, args: [postId] });
      await triggerBuild();
      return 'published';
  }
  const hash = contentHash(text, config.audio.voiceId, config.audio.modelId, config.audio.settings);

  const tx = await db.transaction('write');
  let audioStatus: string | undefined;
  try {
      const found = await tx.execute({ sql: `SELECT status FROM audio WHERE post_id=? AND content_hash=?`, args: [postId, hash] });
      audioStatus = found.rows[0] ? String(found.rows[0]['status']) : undefined;
      if (audioStatus === 'queued' || audioStatus === 'generating') {
        await tx.commit();
        return 'queued';
      }
      if (audioStatus === 'failed') {
        await tx.execute({ sql: `UPDATE audio SET status='queued',error=NULL WHERE post_id=? AND content_hash=? AND status='failed'`, args: [postId, hash] });
      } else if (audioStatus !== 'ready') {
        await tx.execute({
          sql: `INSERT INTO audio (post_id,content_hash,voice_id,model_id,char_count,status)
            VALUES (?,?,?,?,?,'queued') ON CONFLICT(post_id,content_hash) DO NOTHING`,
          args: [postId, hash, config.audio.voiceId, config.audio.modelId, text.length],
        });
      }
      if (audioStatus !== 'ready') {
        await tx.execute({ sql: `UPDATE posts SET status='publishing' WHERE id=? AND status IN ('draft','scheduled','published','publishing')`, args: [postId] });
      }
      await tx.commit();
  } catch (error) {
      await tx.rollback();
      throw error;
  }
  if (audioStatus === 'ready') {
      await db.execute({ sql: `UPDATE posts SET status='published',published_at=COALESCE(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?`, args: [postId] });
      await triggerBuild();
      return 'published';
  }
  const timestamp = Date.now();
  const baseUrl = process.env.URL || process.env.SITE_URL;
  if (!baseUrl) throw new Error('Set URL or SITE_URL so the background narration function can be invoked.');
  const response = await fetch(new URL('/.netlify/functions/narrate-background', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId, timestamp, signature: signJob(postId, timestamp) }),
  });
  if (!response.ok && response.status !== 202) {
    const message = `Narration worker could not be started (HTTP ${response.status}).`;
    await db.execute({ sql: `UPDATE audio SET status='failed',error=? WHERE post_id=? AND content_hash=?`, args: [message, postId, hash] });
    await db.execute({ sql: "UPDATE posts SET status='draft' WHERE id=? AND status='publishing'", args: [postId] });
    throw new Error(message);
  }
  return 'queued';
}

export async function triggerBuild(): Promise<void> {
  const hook = process.env.NETLIFY_BUILD_HOOK_URL;
  if (!hook) throw new Error('Set NETLIFY_BUILD_HOOK_URL to rebuild the static site after publishing.');
  const response = await fetch(hook, { method: 'POST' });
  if (!response.ok) throw new Error(`Netlify build hook returned HTTP ${response.status}.`);
}
