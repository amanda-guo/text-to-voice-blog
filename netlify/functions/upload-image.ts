import { randomUUID } from 'node:crypto';
import type { Handler } from '@netlify/functions';
import { isAuthenticated } from './_shared/auth';
import { json, originIsTrusted } from './_shared/http';
import { putImage } from './_shared/imageStore';

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, { Allow: 'POST' });
  if (!(await isAuthenticated(event.headers.cookie))) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in to upload images.' } });
  if (!originIsTrusted(event)) return json(403, { error: { code: 'BAD_ORIGIN', message: 'Request origin is not allowed.' } });
  let file: FormDataEntryValue | null;
  try {
    if (!event.body) return json(400, { error: { code: 'INVALID_UPLOAD', message: 'Choose an image to upload.' } });
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    const headers = new Headers();
    for (const [name, value] of Object.entries(event.headers)) {
      if (value !== undefined) headers.set(name, value);
    }
    const request = new Request(event.rawUrl, {
      method: 'POST',
      headers,
      body: body as BodyInit,
    });
    const form = await request.formData();
    file = form.get('file');
  } catch {
    return json(400, { error: { code: 'INVALID_UPLOAD', message: 'The image upload could not be read.' } });
  }
  if (!(file instanceof File)) return json(400, { error: { code: 'INVALID_UPLOAD', message: 'Choose an image to upload.' } });
  const extension = extensions[file.type];
  if (!extension) return json(415, { error: { code: 'UNSUPPORTED_IMAGE', message: 'Use a JPEG, PNG, WebP, or AVIF image.' } });
  if (file.size === 0 || file.size > MAX_FILE_SIZE) return json(413, { error: { code: 'IMAGE_TOO_LARGE', message: 'Image must be between 1 byte and 5 MB.' } });
  const key = `${randomUUID()}.${extension}`;
  try {
    await putImage(key, await file.arrayBuffer(), file.type);
    return json(201, { url: `/images/${key}` });
  } catch {
    return json(500, { error: { code: 'IMAGE_STORAGE_FAILED', message: 'The image could not be saved.' } });
  }
};
