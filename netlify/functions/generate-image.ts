import type { Handler } from '@netlify/functions';
import { imageExists, putImage } from './_shared/imageStore';
import { isAuthenticated } from './_shared/auth';
import { json, originIsTrusted, parseBody } from './_shared/http';
import {
  imageExtension,
  isIdeogramGenerationId,
  ideogramImageUrl,
  MAX_GENERATED_IMAGE_BYTES,
  normalizeImagePrompt,
  stableGeneratedImageId,
} from './_shared/ideogram';

const IDEOGRAM_API = 'https://api.ideogram.ai/v2';
const extensions = ['jpg', 'png', 'webp', 'avif'] as const;

type GenerationResponse = {
  generation_id?: unknown;
};

type GenerationStatus = {
  status?: unknown;
  data?: Array<{ object_type?: unknown; is_image_safe?: unknown; url?: unknown }>;
};

async function readImage(response: Response): Promise<Buffer | null> {
  if (!response.body) throw new Error('Image response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GENERATED_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, size);
}

async function downloadGeneratedImage(url: URL): Promise<Response | null> {
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location || redirects === 3) return null;
    const nextUrl = ideogramImageUrl(new URL(location, url).toString());
    if (!nextUrl) return null;
    url = nextUrl;
  }
  return null;
}

async function startGeneration(event: Parameters<Handler>[0]) {
  let body: { prompt?: unknown };
  try {
    body = parseBody(event) as { prompt?: unknown };
  } catch {
    return json(400, { error: { code: 'INVALID_REQUEST', message: 'Send a valid JSON prompt.' } });
  }
  const prompt = normalizeImagePrompt(body.prompt);
  if (!prompt) {
    return json(400, { error: { code: 'INVALID_PROMPT', message: 'Enter an image prompt of 1–1,000 characters.' } });
  }
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) {
    return json(503, { error: { code: 'IMAGE_GENERATION_NOT_CONFIGURED', message: 'Image generation is not configured on the server.' } });
  }

  let response: Response;
  try {
    const form = new FormData();
    form.set('prompt', prompt);
    form.set('async', 'true');
    form.set('num_images', '1');
    form.set('size', '1024x1024');
    response = await fetch(`${IDEOGRAM_API}/image/generate/ideogram-4-5`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return json(502, { error: { code: 'IMAGE_PROVIDER_UNAVAILABLE', message: 'Ideogram could not be reached. Try again shortly.' } });
  }
  if (!response.ok) {
    if (response.status === 422) return json(422, { error: { code: 'PROMPT_REJECTED', message: 'Ideogram rejected this prompt under its safety rules.' } });
    if (response.status === 402) return json(402, { error: { code: 'IMAGE_CREDITS_REQUIRED', message: 'Ideogram needs available API credits before it can generate an image.' } });
    if (response.status === 429) return json(429, { error: { code: 'IMAGE_RATE_LIMITED', message: 'Ideogram is rate-limiting requests. Wait and try again.' } });
    return json(502, { error: { code: 'IMAGE_PROVIDER_ERROR', message: 'Ideogram could not start image generation. Check the server configuration and try again.' } });
  }

  let result: GenerationResponse;
  try {
    result = await response.json() as GenerationResponse;
  } catch {
    return json(502, { error: { code: 'INVALID_PROVIDER_RESPONSE', message: 'Ideogram returned an unreadable response.' } });
  }
  if (!isIdeogramGenerationId(result.generation_id)) {
    return json(502, { error: { code: 'INVALID_PROVIDER_RESPONSE', message: 'Ideogram did not return a valid generation identifier.' } });
  }
  return json(202, { generationId: result.generation_id, status: 'pending' });
}

async function checkGeneration(event: Parameters<Handler>[0]) {
  const generationId = event.queryStringParameters?.generationId || '';
  if (!isIdeogramGenerationId(generationId)) {
    return json(400, { error: { code: 'INVALID_GENERATION_ID', message: 'The image generation identifier is invalid.' } });
  }
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) {
    return json(503, { error: { code: 'IMAGE_GENERATION_NOT_CONFIGURED', message: 'Image generation is not configured on the server.' } });
  }

  let response: Response;
  try {
    response = await fetch(`${IDEOGRAM_API}/generations/${encodeURIComponent(generationId)}`, {
      headers: { 'Api-Key': apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return json(502, { error: { code: 'IMAGE_PROVIDER_UNAVAILABLE', message: 'Ideogram could not be reached. Try again shortly.' } });
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    return json(200, { status: 'pending', retryAfterSeconds: Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter, 2), 30) : 4 });
  }
  if (response.status === 404) return json(404, { error: { code: 'GENERATION_NOT_FOUND', message: 'Ideogram could not find this generation.' } });
  if (!response.ok) return json(502, { error: { code: 'IMAGE_PROVIDER_ERROR', message: 'Ideogram could not retrieve the image status.' } });

  let result: GenerationStatus;
  try {
    result = await response.json() as GenerationStatus;
  } catch {
    return json(502, { error: { code: 'INVALID_PROVIDER_RESPONSE', message: 'Ideogram returned an unreadable status.' } });
  }
  if (result.status === 'pending') return json(200, { status: 'pending', retryAfterSeconds: 4 });
  if (result.status === 'failed') return json(422, { error: { code: 'GENERATION_FAILED', message: 'Ideogram could not generate an image for this prompt.' } });
  if (result.status !== 'completed') return json(502, { error: { code: 'INVALID_PROVIDER_RESPONSE', message: 'Ideogram returned an unknown generation status.' } });
  const generated = result.data?.find((item) => item.object_type === 'image.generation' || item.object_type === undefined);
  if (!generated?.is_image_safe) return json(422, { error: { code: 'IMAGE_NOT_SAFE', message: 'Ideogram did not approve the generated image.' } });
  const imageId = stableGeneratedImageId(generationId);
  for (const extension of extensions) {
    const key = `${imageId}.${extension}`;
    try {
      if (await imageExists(key)) return json(200, { status: 'ready', url: `/images/${key}` });
    } catch {
      return json(500, { error: { code: 'IMAGE_STORAGE_UNAVAILABLE', message: 'The image store could not be checked.' } });
    }
  }
  const sourceUrl = ideogramImageUrl(generated.url);
  if (!sourceUrl) return json(502, { error: { code: 'INVALID_PROVIDER_RESPONSE', message: 'Ideogram returned an invalid image URL.' } });

  let imageResponse: Response;
  try {
    const downloaded = await downloadGeneratedImage(sourceUrl);
    if (!downloaded) return json(502, { error: { code: 'IMAGE_DOWNLOAD_FAILED', message: 'The generated image could not be downloaded. Try generating it again.' } });
    imageResponse = downloaded;
  } catch {
    return json(502, { error: { code: 'IMAGE_DOWNLOAD_FAILED', message: 'The generated image could not be downloaded. Try generating it again.' } });
  }
  if (!imageResponse.ok) return json(502, { error: { code: 'IMAGE_DOWNLOAD_FAILED', message: 'The generated image could not be downloaded. Try generating it again.' } });
  const extension = imageExtension(imageResponse.headers.get('content-type'));
  if (!extension) return json(502, { error: { code: 'UNSUPPORTED_GENERATED_IMAGE', message: 'Ideogram returned an unsupported image format.' } });
  const contentLength = Number(imageResponse.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_GENERATED_IMAGE_BYTES) {
    return json(413, { error: { code: 'GENERATED_IMAGE_TOO_LARGE', message: 'The generated image exceeds the 5 MB storage limit.' } });
  }
  let image: Buffer | null;
  try {
    image = await readImage(imageResponse);
  } catch {
    return json(502, { error: { code: 'IMAGE_DOWNLOAD_FAILED', message: 'The generated image could not be downloaded. Try generating it again.' } });
  }
  if (image?.length === 0) return json(502, { error: { code: 'INVALID_IMAGE', message: 'Ideogram returned an empty image.' } });
  if (!image) return json(413, { error: { code: 'GENERATED_IMAGE_TOO_LARGE', message: 'The generated image exceeds the 5 MB storage limit.' } });

  const key = `${imageId}.${extension}`;
  try {
    await putImage(key, image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer, `image/${extension === 'jpg' ? 'jpeg' : extension}`);
  } catch {
    return json(500, { error: { code: 'IMAGE_STORAGE_FAILED', message: 'The generated image could not be saved.' } });
  }
  return json(200, { status: 'ready', url: `/images/${key}` });
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST to start generation or GET to check its status.' } }, { Allow: 'GET, POST' });
  }
  if (!(await isAuthenticated(event.headers.cookie))) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in to generate images.' } });
  if (!originIsTrusted(event)) return json(403, { error: { code: 'BAD_ORIGIN', message: 'Request origin is not allowed.' } });
  return event.httpMethod === 'POST' ? startGeneration(event) : checkGeneration(event);
};
