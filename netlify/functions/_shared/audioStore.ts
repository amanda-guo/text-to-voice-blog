import { getStore } from '@netlify/blobs';

const audioBlobs = () => getStore('narration');

export async function putAudio(key: string, audio: ArrayBuffer): Promise<void> {
  await audioBlobs().set(key, audio, { metadata: { contentType: 'audio/mpeg' } });
}

export async function getAudio(key: string): Promise<ReadableStream<Uint8Array> | null> {
  const blob = await audioBlobs().getWithMetadata(key, { type: 'stream' });
  return blob?.data as ReadableStream<Uint8Array> | null;
}

export async function audioExists(key: string): Promise<boolean> {
  return (await audioBlobs().getMetadata(key)) !== null;
}
