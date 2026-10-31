export const config = {
  siteUrl: (process.env.SITE_URL || 'https://example.netlify.app').replace(/\/$/, ''),
  siteName: process.env.SITE_NAME || 'Voice-narrated blog',
  author: process.env.SITE_AUTHOR || 'Blog author',
  description: process.env.SITE_DESCRIPTION || 'Long-form writing, to read or listen.',
  accent: process.env.SITE_ACCENT || '#8a4c33',
  audio: {
    voiceId: process.env.ELEVENLABS_VOICE_ID || (process.env.ELEVENLABS_MOCK === '1' ? 'mock-voice' : ''),
    modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
  },
};

export type Tag = { slug: string; name: string };
export type Audio = {
  content_hash: string;
  blob_key: string;
  duration_sec: number | null;
  byte_size: number | null;
};
export type Post = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  body_md: string;
  narration_override: string | null;
  status: string;
  publish_at: string | null;
  published_at: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  audio?: Audio | null;
};
