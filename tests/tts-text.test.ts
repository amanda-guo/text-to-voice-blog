import { describe, expect, it } from 'vitest';
import { contentHash, narrationText, plainText, slugify, splitNarration } from '../src/lib/tts-text';
import { parseByteRange, sliceByteStream } from '../src/lib/byte-range';

describe('narration text preparation', () => {
  it('adds the title and author and removes links, images, footnotes, and HTML', () => {
    const text = narrationText('A post', 'A writer', `## Heading\n\nA [useful link](https://example.com) and ![decorative image](https://example.com/image.jpg).\n\n<em>Text</em>[^1]`);
    expect(text).toContain('A post. By A writer.');
    expect(text).toContain('Heading.');
    expect(text).toContain('A useful link and .');
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('decorative image');
    expect(text).not.toContain('<em>');
  });

  it('replaces fenced code with the spoken explanation and expands common pronunciations', () => {
    expect(plainText('SSO vs. password\n\n```ts\nconst privateValue = 1;\n```'))
      .toBe('S S O versus password\n\nThere is a code example here; see the written post.');
  });

  it('uses a supplied narration override', () => {
    expect(narrationText('Title', 'Author', 'Ignored body', 'Speak this instead'))
      .toBe('Title. By Author.\n\nSpeak this instead');
  });
});

describe('narration chunking and identifiers', () => {
  it('keeps paragraphs intact where possible and caps chunks at the configured size', () => {
    const chunks = splitNarration(`${'First paragraph. '.repeat(30)}\n\n${'Second paragraph. '.repeat(30)}`, 600);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 600)).toBe(true);
  });

  it('rejects narration over the hard limit', () => {
    expect(() => splitNarration('a'.repeat(40_001))).toThrow(/40,000/);
  });

  it('hashes narration, voice, model, and settings deterministically', () => {
    expect(contentHash('words', 'voice', 'model', { stability: 0.5 })).toBe(contentHash('words', 'voice', 'model', { stability: 0.5 }));
    expect(contentHash('words', 'voice', 'model', {})).not.toBe(contentHash('changed', 'voice', 'model', {}));
  });

  it('generates lowercase kebab-case slugs', () => {
    expect(slugify('Hello, World! 2026')).toBe('hello-world-2026');
  });

  it('parses normal, suffix, and invalid byte ranges', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=100-', 100)).toBe(false);
    expect(parseByteRange('bytes=0-1,4-5', 100)).toBe(false);
    expect(parseByteRange(undefined, 100)).toBeNull();
  });

  it('streams only the requested byte range across chunk boundaries', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([0, 1, 2]));
        controller.enqueue(Uint8Array.from([3, 4, 5, 6]));
        controller.close();
      },
    });
    const bytes = new Uint8Array(await new Response(sliceByteStream(source, 2, 5)).arrayBuffer());
    expect([...bytes]).toEqual([2, 3, 4, 5]);
  });
});
