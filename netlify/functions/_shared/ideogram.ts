import { createHash } from 'node:crypto';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export const MAX_IMAGE_PROMPT_LENGTH = 1000;
export const MAX_GENERATED_IMAGE_BYTES = 5 * 1024 * 1024;

export function normalizeImagePrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const prompt = value.trim();
  return prompt.length > 0 && prompt.length <= MAX_IMAGE_PROMPT_LENGTH ? prompt : null;
}

export function isIdeogramGenerationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}={0,2}$/.test(value);
}

export function imageExtension(contentType: string | null): string | null {
  if (!contentType) return null;
  return IMAGE_EXTENSIONS[contentType.split(';', 1)[0]!.trim().toLowerCase()] || null;
}

export function ideogramImageUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const hostIsIdeogram = url.hostname === 'ideogram.ai' || url.hostname.endsWith('.ideogram.ai');
    if (url.protocol !== 'https:' || !hostIsIdeogram || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

export function stableGeneratedImageId(generationId: string): string {
  const digest = createHash('sha256').update(generationId).digest('hex').slice(0, 32);
  const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = `${digest.slice(0, 12)}5${digest.slice(13, 16)}${variant}${digest.slice(17)}`;
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}
