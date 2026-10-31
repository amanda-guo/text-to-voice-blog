import { getStore } from '@netlify/blobs';

const imageBlobs = () => getStore('blog-images');

export async function putImage(key: string, data: ArrayBuffer, contentType: string): Promise<void> {
  await imageBlobs().set(key, data, { metadata: { contentType } });
}

export async function getImage(key: string) {
  return imageBlobs().getWithMetadata(key, { type: 'stream' });
}

export async function imageExists(key: string): Promise<boolean> {
  return (await imageBlobs().getMetadata(key)) !== null;
}
