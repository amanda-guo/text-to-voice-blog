import { createClient, type Client } from '@libsql/client';
import { config, type Post } from './config';
import { contentHash, narrationText } from './tts-text';

let client: Client | undefined;

export function getDb(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL is required. Set it in the environment.');
  if (!client) {
    client = createClient({
      url,
      authToken: url.startsWith('file:') ? undefined : process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

export async function publishedPosts(limit = 1000): Promise<Post[]> {
  const result = await getDb().execute({
    sql: `SELECT p.* FROM posts p
      WHERE p.status = 'published'
      ORDER BY p.published_at DESC LIMIT ?`,
    args: [limit],
  });
  return Promise.all(result.rows.map(async (row) => {
    const post = row as unknown as Post;
    const tagRows = await getDb().execute({
      sql: `SELECT t.slug, t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=? ORDER BY t.name`,
      args: [post.id],
    });
    const text = narrationText(post.title, config.author, post.body_md, post.narration_override);
    const currentHash = contentHash(text, config.audio.voiceId, config.audio.modelId, config.audio.settings);
    const audioRows = await getDb().execute({
      sql: `SELECT content_hash, blob_key, duration_sec, byte_size FROM audio
        WHERE post_id=? AND content_hash=? AND status='ready' AND blob_key IS NOT NULL LIMIT 1`,
      args: [post.id, currentHash],
    });
    return {
      ...post,
      tags: tagRows.rows as unknown as Post['tags'],
      audio: (audioRows.rows[0] as unknown as Post['audio']) || null,
    };
  }));
}

export async function getPublishedPost(slug: string): Promise<Post | undefined> {
  return (await publishedPosts()).find((post) => post.slug === slug);
}
