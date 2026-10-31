import { z } from 'zod';
import { getDb } from '../../../src/lib/db';
import { slugify } from '../../../src/lib/tts-text';

export const postInput = z.object({
  id: z.coerce.number().int().positive().optional(),
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(80).optional(),
  excerpt: z.string().trim().max(300).optional().nullable(),
  body_md: z.string().trim().min(1).max(100_000),
  narration_override: z.string().max(40_000).optional().nullable(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  hero_image_url: z.string().url().optional().or(z.literal('')).nullable(),
  hero_image_alt: z.string().max(300).optional().nullable(),
});

export type PostInput = z.infer<typeof postInput>;

export async function savePost(input: PostInput, create: boolean) {
  const db = getDb();
  const slug = slugify(input.slug || input.title);
  if (!slug) throw new Error('Post title must include at least one letter or number.');
  const tags = (Array.isArray(input.tags) ? input.tags : (input.tags || '').split(','))
    .map((tag) => tag.trim()).filter(Boolean).map((name) => ({ name, slug: slugify(name) }));
  const tx = await db.transaction('write');
  try {
    let postId = input.id;
    if (create) {
      const inserted = await tx.execute({
        sql: `INSERT INTO posts (slug,title,excerpt,body_md,narration_override,hero_image_url,hero_image_alt)
          VALUES (?,?,?,?,?,?,?)`,
        args: [slug, input.title, input.excerpt || null, input.body_md, input.narration_override || null, input.hero_image_url || null, input.hero_image_alt || null],
      });
      postId = Number(inserted.lastInsertRowid);
    } else {
      if (!postId) throw new Error('Post ID is required.');
      const found = await tx.execute({ sql: 'SELECT status,slug FROM posts WHERE id=?', args: [postId] });
      if (!found.rows.length) throw new Error('Post not found.');
      const existing = { status: String(found.rows[0]!['status']), slug: String(found.rows[0]!['slug']) };
      const nextSlug = existing.status === 'published' ? existing.slug : slug;
      await tx.execute({
        sql: `UPDATE posts SET slug=?,title=?,excerpt=?,body_md=?,narration_override=?,hero_image_url=?,hero_image_alt=?,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
        args: [nextSlug, input.title, input.excerpt || null, input.body_md, input.narration_override || null, input.hero_image_url || null, input.hero_image_alt || null, postId],
      });
      await tx.execute({ sql: 'DELETE FROM post_tags WHERE post_id=?', args: [postId] });
    }
    for (const tag of tags) {
      if (!tag.slug) continue;
      await tx.execute({ sql: 'INSERT INTO tags (slug,name) VALUES (?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name', args: [tag.slug, tag.name] });
      await tx.execute({ sql: 'INSERT OR IGNORE INTO post_tags (post_id,tag_id) SELECT ?,id FROM tags WHERE slug=?', args: [postId!, tag.slug] });
    }
    const result = await tx.execute({ sql: 'SELECT * FROM posts WHERE id=?', args: [postId!] });
    await tx.commit();
    return result.rows[0];
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function postWithTags(id: number) {
  const db = getDb();
  const result = await db.execute({ sql: 'SELECT * FROM posts WHERE id=?', args: [id] });
  if (!result.rows[0]) return undefined;
  const tagRows = await db.execute({
    sql: 'SELECT t.name,t.slug FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=? ORDER BY t.name',
    args: [id],
  });
  const audioRows = await db.execute({
    sql: `SELECT content_hash,status,duration_sec,error,created_at FROM audio WHERE post_id=? ORDER BY created_at DESC LIMIT 1`,
    args: [id],
  });
  return { ...result.rows[0], tags: tagRows.rows, audio: audioRows.rows[0] || null };
}
