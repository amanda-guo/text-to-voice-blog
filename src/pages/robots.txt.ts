import type { APIRoute } from 'astro';
import { config } from '../lib/config';

export const GET: APIRoute = () => new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${config.siteUrl}/sitemap.xml\n`, {
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
});
