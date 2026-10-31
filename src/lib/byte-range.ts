export type ByteRange = { start: number; end: number };

export function parseByteRange(header: string | undefined, size: number): ByteRange | null | false {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (start >= size || end < start) return false;
  return { start, end: Math.min(end, size - 1) };
}

export function sliceByteStream(source: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (offset <= end) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const chunkStart = offset;
        const chunkEnd = offset + value.byteLength - 1;
        offset += value.byteLength;
        if (chunkEnd < start) continue;
        const from = Math.max(0, start - chunkStart);
        const to = Math.min(value.byteLength, end - chunkStart + 1);
        controller.enqueue(value.subarray(from, to));
        if (offset > end) {
          await reader.cancel();
          controller.close();
        }
        return;
      }
      controller.close();
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}
