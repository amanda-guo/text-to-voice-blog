import { createHash } from 'node:crypto';
export { narrationText, plainText, slugify, splitNarration } from './narration-text';

export function contentHash(text: string, voiceId: string, modelId: string, settings: object): string {
  return createHash('sha256').update(JSON.stringify([text, voiceId, modelId, settings])).digest('hex');
}
