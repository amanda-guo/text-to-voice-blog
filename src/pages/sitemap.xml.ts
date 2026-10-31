import type { APIRoute } from 'astro';
import { config } from '../lib/config';
import { publishedPosts } from '../lib/db';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const GET: APIRoute = async () => {
  const posts = await publishedPosts();
  const tags = [...new Set(posts.flatMap((post) => post.tags.map((tag) => tag.slug)))];
  const urls = [`${config.siteUrl}/`, `${config.siteUrl}/about/`, ...posts.map((post) => `${config.siteUrl}/posts/${post.slug}/`), ...tags.map((tag) => `${config.siteUrl}/tags/${tag}/`)];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escape(url)}</loc></url>`).join('')}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
