import type { APIRoute } from 'astro';
import { config } from '../lib/config';
import { publishedPosts } from '../lib/db';
import { renderMarkdown } from '../lib/markdown';

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export const GET: APIRoute = async () => {
  const posts = await publishedPosts(50);
  const items = await Promise.all(posts.map(async (post) => {
    const url = `${config.siteUrl}/posts/${post.slug}/`;
    return `<item><title>${xml(post.title)}</title><link>${xml(url)}</link><guid isPermaLink="true">${xml(url)}</guid><pubDate>${new Date(post.published_at || post.created_at).toUTCString()}</pubDate><description>${xml(post.excerpt || '')}</description><content:encoded><![CDATA[${(await renderMarkdown(post.body_md)).replace(/]]>/g, ']]]]><![CDATA[>')}]]></content:encoded></item>`;
  }));
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${xml(config.siteName)}</title><link>${xml(config.siteUrl)}</link><description>${xml(config.description)}</description><language>en</language>${items.join('')}</channel></rss>`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
