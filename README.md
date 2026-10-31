# Voice-narrated blog

An Astro static blog hosted on Netlify. Public pages are generated from Turso at build time; private Netlify Functions power the owner admin, publishing workflow, ElevenLabs narration, Ideogram image generation, and media streaming. Provider credentials are server-side only.

## Local development

1. Install Node.js 22 or newer and the Netlify CLI.
2. The Stripe Projects CLI provisions the Turso, Netlify, and ElevenLabs resources and writes their credentials to the project-managed `.env`. Never commit `.env`.
3. Copy `.env.example` to `.env` only if you are not using the Projects-managed environment. Keep `TURSO_DATABASE_URL=file:local.db` and `ELEVENLABS_MOCK=1` to avoid cloud database writes and TTS charges while developing.
4. Configure the app-only values below. Run `npm run hash-password` in a terminal to create a bcrypt hash without echoing the password, then store the hash in `ADMIN_PASSWORD_HASH`; generate a session secret with `openssl rand -base64 32` (Projects already created one for the current environment).
5. Run `npm install`, `npm run migrate`, and `npm run seed` to set up a local database with three sample posts.
6. Run `npm run dev` for Netlify Dev, including Functions. A local file database and mocked narration avoid external usage charges.

`npm run build` applies migrations and builds static pages from published Turso posts. `npm test` and `npm run typecheck` run the unit tests and TypeScript checks.

## Configuration

| Variable | Scope | Purpose |
|---|---|---|
| `TURSO_DATABASE_URL` | Build and Functions | Turso libSQL URL; `file:local.db` for local work |
| `TURSO_AUTH_TOKEN` | Build and Functions | Database token; leave unset for a local file database |
| `ELEVENLABS_API_KEY` | Functions | TTS API key |
| `ELEVENLABS_VOICE_ID` | Build and Functions | Narrator voice ID; static builds use it to identify matching ready audio |
| `ELEVENLABS_MODEL_ID` | Build and Functions | Defaults to `eleven_multilingual_v2`; builds need the same value used at publish time |
| `ELEVENLABS_BASE_URL` | Functions | API base URL |
| `ELEVENLABS_MOCK` | Functions | `1` enables silent mock audio in local development |
| `IDEOGRAM_API_KEY` | Functions | Server-only API key for Ideogram image generation |
| `ADMIN_PASSWORD_HASH` | Functions | bcrypt hash of the owner password |
| `SESSION_SECRET` | Functions | Random secret of at least 32 bytes for signed sessions and internal jobs |
| `NETLIFY_BUILD_HOOK_URL` | Functions | Netlify build hook that rebuilds public static pages |
| `SITE_URL` | Build and Functions | Canonical public URL (and local origin for Netlify Dev) |
| `SITE_NAME` | Build | Blog title |
| `SITE_AUTHOR` | Build and Functions | Author name used in the page metadata and narration intro |
| `SITE_DESCRIPTION` | Build | Site description |
| `SITE_ACCENT` | Build | Accent color |

Stripe Projects supplies `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ELEVENLABS_API_KEY`, and the Netlify resource credentials. Add the owner-selected `ELEVENLABS_VOICE_ID`, bcrypt hash, session secret, build hook URL, and optional `IDEOGRAM_API_KEY` to the Function environment. Do not use any `PUBLIC_` prefix for secrets. To store a rotated Ideogram key in Stripe Projects without putting it in shell history or chat, run `stripe projects variables set ideogram-api-key --env-key IDEOGRAM_API_KEY` interactively; the CLI securely prompts for the value when `--value` is omitted. Also configure it in the deployed Netlify Function environment; the local Projects variable does not by itself configure a separately hosted Netlify deployment.

## Content and publishing

Open `/admin/`, sign in, create or edit a Markdown draft, and save it. The editor autosaves drafts after five seconds, previews sanitized Markdown and the exact spoken text, and supports image URLs or uploads (JPEG/PNG/WebP/AVIF, up to 5 MB). Publish starts a background narration job; the page becomes public after the MP3 is stored. Schedule selects a future date and the scheduled Function checks for due posts every 15 minutes. A failed narration can be retried or the post may be published without audio.

The admin can generate one 1K illustration from an image prompt with Ideogram, then assign it as the hero image or insert it into the Markdown body. Each generation may consume Ideogram API credits. The API key is used only by the authenticated Netlify Function; generated provider URLs are downloaded immediately because they expire, and the image is saved in Netlify Blobs. Add descriptive alt text before publishing. Image generation requires a server-side `IDEOGRAM_API_KEY`; it is unavailable until configured. The integration uses [Ideogram's v2 image generation and polling endpoints](https://developer.ideogram.ai/v2/api-reference/images/generate/ideogram-4-5).

Changing text does not regenerate audio automatically. Use Publish/Retry narration to create audio for a new narration hash. Unchanged text, voice, model, and settings reuse the existing audio. Audio is served from `/audio/{slug}-{hash8}.mp3` with byte-range support.

The admin enforces alt text for hero and inline images when publishing. The podcast feed, paragraph-synced highlighting, and other stretch features are not included in this first implementation.

## Netlify deployment

Connect the repository to the provisioned Netlify site, set the build command to `npm run build`, and ensure build-time Turso credentials are available. Add the app-only values above as Netlify Function/Build environment variables, scoped to the narrowest required context. Create a Netlify Build Hook and set `NETLIFY_BUILD_HOOK_URL`. The Netlify deployment URL is the initial `SITE_URL`; update it for a custom domain later.

Run `npm run seed` once only when you want the three example posts in the connected database. Do not run it against a database that already contains content.

## Security and operations

Admin sessions use HttpOnly, Secure, SameSite=Strict cookies; mutating admin routes check Origin. Login attempts are limited to five per IP per 15-minute window. SQL statements are parameterized, Markdown is sanitized before rendering, and the audio worker validates a short-lived HMAC-signed job before calling ElevenLabs. Image prompts and API keys must not be logged; the Ideogram key must never be exposed to browser code.

Rotate provider credentials through Stripe Projects and redeploy. Rotate `SESSION_SECRET` to invalidate existing sessions and internal job signatures. The CI build scans generated public files for known secret names and key patterns.
