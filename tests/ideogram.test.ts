import { describe, expect, it } from 'vitest';
import {
  imageExtension,
  isIdeogramGenerationId,
  ideogramImageUrl,
  MAX_IMAGE_PROMPT_LENGTH,
  normalizeImagePrompt,
  stableGeneratedImageId,
} from '../netlify/functions/_shared/ideogram';

describe('Ideogram image request validation', () => {
  it('trims non-empty prompts and enforces the request length limit', () => {
    expect(normalizeImagePrompt('  A quiet forest  ')).toBe('A quiet forest');
    expect(normalizeImagePrompt('   ')).toBeNull();
    expect(normalizeImagePrompt('x'.repeat(MAX_IMAGE_PROMPT_LENGTH + 1))).toBeNull();
    expect(normalizeImagePrompt(42)).toBeNull();
  });

  it('accepts only HTTPS image URLs from Ideogram domains', () => {
    expect(ideogramImageUrl('https://ideogram.ai/api/image/1')?.hostname).toBe('ideogram.ai');
    expect(ideogramImageUrl('https://assets.ideogram.ai/image/1')?.hostname).toBe('assets.ideogram.ai');
    expect(ideogramImageUrl('http://ideogram.ai/image/1')).toBeNull();
    expect(ideogramImageUrl('https://ideogram.ai.attacker.test/image/1')).toBeNull();
    expect(ideogramImageUrl('https://user@ideogram.ai/image/1')).toBeNull();
  });

  it('allows only image formats supported by the public image route', () => {
    expect(imageExtension('image/jpeg; charset=binary')).toBe('jpg');
    expect(imageExtension('image/png')).toBe('png');
    expect(imageExtension('image/webp')).toBe('webp');
    expect(imageExtension('image/avif')).toBe('avif');
    expect(imageExtension('image/svg+xml')).toBeNull();
  });

  it('accepts URL-safe generation identifiers, including base64 padding', () => {
    expect(isIdeogramGenerationId('generation_example-123')).toBe(true);
    expect(isIdeogramGenerationId('generation_example-123==')).toBe(true);
    expect(isIdeogramGenerationId('invalid/id')).toBe(false);
    expect(isIdeogramGenerationId('x'.repeat(257))).toBe(false);
  });

  it('derives stable UUID-format image names from generation IDs', () => {
    const first = stableGeneratedImageId('generation_example-123');
    expect(first).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    expect(first[14]).toBe('5');
    expect(['8', '9', 'a', 'b']).toContain(first[19]);
    expect(stableGeneratedImageId('generation_example-123')).toBe(first);
    expect(stableGeneratedImageId('another-generation')).not.toBe(first);
  });
});
