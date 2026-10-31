import 'dotenv/config';
import { getDb } from '../src/lib/db';

const db = getDb();
const examples = [
  {
    slug: 'a-small-beginning',
    title: 'A Small Beginning',
    excerpt: 'Why this blog is beginning with a simple promise: thoughtful words, read or heard.',
    body_md: `# A small beginning\n\nA good idea often starts with a small experiment. This blog is one: a place for considered writing, with an audio version for the moments when reading is not convenient.\n\nThe goal is not to publish more. It is to pay closer attention, then share what seems useful.\n\n## What comes next\n\nThere will be notes from work, lessons from building, and questions that deserve a longer answer. Thank you for being here.`,
    tags: ['Notes', 'Writing'],
  },
  {
    slug: 'systems-that-help-us-focus',
    title: 'Systems That Help Us Focus',
    excerpt: 'A few modest routines can make room for more meaningful work.',
    body_md: `# Systems that help us focus\n\nAttention is finite. A useful system does not create more of it; it helps us spend it intentionally.\n\n- Keep the next action visible.\n- Make interruptions costly enough to notice.\n- Leave a short note before changing tasks.\n\n\`\`\`text\ncapture -> choose -> focus -> review\n\`\`\`\n\nThe code example is a reminder, not a prescription. A system is working when it makes the important thing easier to return to.`,
    tags: ['Work', 'Practice'],
  },
  {
    slug: 'the-shape-of-a-good-question',
    title: 'The Shape of a Good Question',
    excerpt: 'Better questions are specific enough to act on and open enough to learn from.',
    body_md: `# The shape of a good question\n\nA useful question has a boundary. It gives people enough context to reason, without smuggling in the answer.\n\nFor example, “How should this work on a phone?” is more actionable than “Can you make it better?” It names a setting and invites judgment.\n\n![A notebook beside a cup of tea](https://images.unsplash.com/photo-1455390582262-044cdead277a?w=1200)\n\nGood questions are a form of hospitality: they make it possible for others to contribute.`,
    tags: ['Writing', 'Practice'],
  },
];

const count = await db.execute('SELECT COUNT(*) AS count FROM posts');
if (Number(count.rows[0]?.count) === 0) {
  for (const example of examples) {
    const result = await db.execute({
      sql: `INSERT INTO posts (slug, title, excerpt, body_md, status, published_at)
        VALUES (?, ?, ?, ?, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      args: [example.slug, example.title, example.excerpt, example.body_md],
    });
    for (const name of example.tags) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await db.execute({ sql: 'INSERT INTO tags (slug,name) VALUES (?,?) ON CONFLICT(slug) DO NOTHING', args: [slug, name] });
      await db.execute({
        sql: `INSERT OR IGNORE INTO post_tags (post_id,tag_id) SELECT ?,id FROM tags WHERE slug=?`,
        args: [Number(result.lastInsertRowid), slug],
      });
    }
  }
  console.log('Inserted three sample posts.');
} else {
  console.log('Database already contains posts; sample content was not added.');
}
await db.close();
