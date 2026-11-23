# GTA 6 Clipper

Turn live GTA 6 chat spikes into vertical Shorts you can review, download, and — on the Studio plan — auto-post.

This is an original starter for a clipping desk: a Next.js web app plus a separate worker that will run ffmpeg, streamlink/yt-dlp, and self-hosted Whisper. It is **not** affiliated with Rockstar Games, Take-Two Interactive, or any other clipping product. Grand Theft Auto and GTA are trademarks of their owners. Stream footage belongs to the streamers who produce it.

**Do not clone, copy, or redeploy another vendor's source, branding, or assets into this repo.**

## Read the plan first

The full project plan (architecture, stack, phases, API sequencing, risks, and costs) is here:

- [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md)

### Plan in brief

- **Scope:** Live Radar for GTA 6 Twitch streams, up to 10 concurrent live clips, YouTube import up to 6 hours, chat-spike detection, 9:16 action-following reframes, AI captions, AI titles/hashtags, 1080p export with no watermark, and Studio auto-post to TikTok, YouTube Shorts, Instagram Reels, and Facebook.
- **Pricing:** Starter $49 / Pro $99 / Studio $199 per month. Auto-post is Studio only.
- **Platforms:** All four destinations are in scope. Download works on every plan from the start. Auto-post is sequenced by official API approval: YouTube Shorts first (default Data API quota is enough to start), then Instagram and Facebook after Meta review, then TikTok after the Content Posting API audit. Hurdles are scheduling risks, not cuts.
- **Cost posture:** Prefer free official APIs, free-tier auth/database/storage, and open-source media/AI. The one bill you cannot avoid is an always-on worker VPS. See the [Costs section](docs/PROJECT_PLAN.md#12-costs).
- **Vercel Hobby warning:** Hobby is for personal or non-commercial use only (Vercel Terms of Service, Section 4, updated 19 October 2026). Do not take payment or market paid plans on Hobby. Before charging customers, move the frontend to **Cloudflare Pages** (preferred $0 path) or **Vercel Pro** (commonly ~$20/month — verify at purchase time).

### Build phases (solo full-time developer, rough estimates)

| Phase | Focus | Estimate |
|---|---|---|
| 0. Foundation | App, auth, schema, pricing pages | 2 weeks |
| 1. Live Radar | Twitch Helix directory | 2 weeks |
| 2. Chat spikes | IRC / EventSub + hype score | 2–3 weeks |
| 3. Clipping pipeline | VPS, ffmpeg, 1080p, Clip Queue | 3–4 weeks |
| 4. Captions and titles | faster-whisper + local/free LLM | 2–3 weeks |
| 5. Action crop + 10 streams | Motion-following 9:16, concurrency | 2–3 weeks |
| 6. YouTube import | VODs up to 6 hours | 1–2 weeks |
| 7. Auto-post | YouTube, then Meta, then TikTok | 3–5 weeks engineering + review waits |
| 8. Billing and launch | Stripe, seats, leave Hobby before charging | 2–3 weeks |

Total: about **19–27 weeks**, plus API review calendar time. A demo with downloadable captioned Shorts is realistic after phases 0–4 (~10–14 weeks).

## Repository layout

```
apps/web/     Next.js + TypeScript app (placeholder routes)
worker/       Job-runner skeleton for the ffmpeg / Whisper pipeline
docs/         Project plan
.env.example  Required keys — never commit real secrets
```

This is a lean scaffold. Dependencies are declared in `package.json` files but are **not** installed in this commit.

## Quick start (when you are ready to install)

You will need Node.js 20+, and later (for the worker) Redis, ffmpeg, Python 3, streamlink, yt-dlp, and a Whisper model. Nothing below is required just to read the plan.

```bash
cp .env.example .env.local
# fill in only the keys you are using

npm install
npm run dev --workspace=web
```

The web app is intended to run at [http://localhost:3000](http://localhost:3000). Placeholder routes:

- `/` — landing
- `/pricing` — Starter / Pro / Studio
- `/login` — sign-in placeholder
- `/radar` — Live Radar placeholder
- `/queue` — Clip Queue placeholder
- `/import` — YouTube import placeholder

```bash
npm run dev --workspace=worker
```

The worker will not capture streams or render clips until those phases are built. It is a typed skeleton only.

## Cost-minded defaults already baked into the design

- Twitch and YouTube official APIs: $0 within rate limits / quota.
- Captions: self-hosted faster-whisper, and only on the cut clip, not the whole stream.
- Titles: local LLM (for example Ollama) or a free-tier API fallback.
- Auth and database: Supabase Free (note: free projects pause after one week idle).
- Storage: Cloudflare R2 free tier (10 GB-month, 1 million Class A, 10 million Class B, $0 egress).
- Frontend: Vercel Hobby **or** Cloudflare Pages during non-commercial development.
- Unavoidable paid cost: the worker VPS (roughly $5–30/month early on, more if you scale). Payment processor fees apply per charge once you sell subscriptions.

## License and use

No license file is included yet. Stream content, game footage, and trademarks remain with their owners. Only clip streams and videos you have permission to use.
