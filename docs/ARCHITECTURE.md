# Architecture

GTA 6 Clipper is a TypeScript monorepo. The web app never talks to Twitch, Redis, or ffmpeg directly from the browser. Server-side services and a long-running worker own those integrations.

## Folder layout

```
gta6-clipper/
├── apps/web/                 # Next.js UI (and thin HTTP route handlers)
│   ├── app/                  # App Router pages and route handlers
│   ├── components/           # Presentational React components
│   ├── lib/                  # UI-only helpers (for example plan copy)
│   └── server/               # Next.js server adapters (import "server-only")
├── packages/
│   ├── shared/               # Config, logger, typed errors, domain types
│   └── twitch/               # Twitch Helix client, schemas, and radar query
├── worker/                   # Auto worker on the owner's PC (capture, chat, ffmpeg, Whisper, Ollama)
├── supabase/migrations/      # Postgres schema + RLS (applied to the gta6-clipper project)
├── docs/                     # Project plan and this document
├── .env.example              # Names of env vars — no secrets
└── .env.local                # Real secrets, repo root, never committed
```

### What each layer does

| Layer        | Location                                                 | Responsibility                                                                                                                                    |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| App          | `apps/web/app`, `apps/web/components`, `apps/web/lib`    | Pages, layout, and presentational UI only. Live Radar renders data it receives from the server layer.                                             |
| API / server | `apps/web/server`, `apps/web/app/api`, `packages/twitch` | Typed server adapters and HTTP routes. The Twitch package is the reusable Helix client (token cache, retries, Zod validation, stream listing).    |
| Shared       | `packages/shared`                                        | One config loader for every env var, pino logging (secrets redacted), typed errors, and domain types such as `LiveStream` used by web and worker. |
| Worker       | `worker/`                                                | Long-lived processes that cannot run on Vercel: chat ingest, spike detection, ffmpeg, Whisper, and later publish jobs.                            |

Environment loading: Next.js reads `apps/web/.env.local`, which is a symlink to the repo-root `.env.local`. The shared config loader also reads the repo-root file (without overriding already-set process env) so the worker and packages see the same values. Config validation fails fast with field names only — it never logs secret values.

## Request path for Live Radar (this phase)

1. `GET /radar` (App Router server component) calls `loadRadarData()` in `apps/web/server`.
2. That adapter calls `getLiveGta6Streams()` in `packages/twitch`.
3. The Twitch client fetches an app access token (`client_credentials`), caches it until near expiry, resolves the Grand Theft Auto VI category (`/helix/games`, then `/helix/search/categories`), and pages `/helix/streams`.
4. 401 responses invalidate the token and retry once. 429 responses honour `Retry-After` / `Ratelimit-Reset` for a short wait, then surface a typed rate-limit error.
5. Zod parses every Helix payload. The page shows an empty state, a ranked stream list, or a safe error message.
6. `GET /api/streams` exposes the same result as JSON for later client refresh.

## Hosting

The owner's own PC is the server. `npm run dev` / `npm run start` (web) and `npm run auto --workspace=worker` (worker) run side by side on it; Supabase (auth + Postgres) and Twitch Helix are the only cloud services. A VPS is optional and runs the same commands. Setup, autostart and resume are in [SELF_HOST.md](SELF_HOST.md).

## Auto worker pipeline (current)

```
Helix (watchlist + GTA VI directory) ──► selectStreams (≤ 3)
   │
   ├─► StreamCapture per stream: streamlink → ffmpeg segment muxer (6 s .ts + CSV timing, 150 s ring buffer)
   ├─► Anonymous IRC ──► ChannelSpikeDetector (1 s bins, baseline, distinct users, peak/onset)
   │                 └─► QuestionReplyDetector (broadcaster "?" messages + spoken questions)
   └─► Speech sampler: last ~35 s audio → faster-whisper tiny → findSpokenQuestions
           │
   moment ─► window (pre/post-roll, chat delay) ─► dedupe ─► plan limits ─► wait for buffer
           ─► extractWindow ─► runClipJob (render semaphore = 1):
                silence/scene snap → facecam consensus → transcript (aligned to trim)
                → Ollama titles (template fallback) → render (.partial.mp4 → rename)
                → peak thumbnail → LUFS check → sidecar JSON → SQLite / Supabase row
```

- **Selection:** watchlisted streamers live in GTA VI (GTA V too if `AUTO_INCLUDE_GTA_V=true`) by watchlist priority then viewers, then the rest by viewers. Cap = `min(AUTO_TOP_K, plan streams, AUTO_MAX_CONCURRENT=3)`.
- **No permission gate.** Every clip gets a streamer credit overlay.
- **Storage:** local SQLite (`clipper.sqlite` in `AUTO_DATA_DIR`) by default; Supabase when `SUPABASE_SERVICE_ROLE_KEY` and `AUTO_WORKSPACE_ID` are set. Highlight timestamps (`event_at`, `peak_at`, `highlight_start_at/end_at`, `peak_offset_seconds`, `hype_score`, `clip_type`) are stored in both and in the sidecar JSON next to each MP4.
- **AI text:** Ollama only (`OLLAMA_URL`, `OLLAMA_MODEL`), Zod-validated JSON, en/sv templates as fallback. Transcription is faster-whisper.

## How later phases plug in

Phase numbers match `docs/PROJECT_PLAN.md` (the plan's phases 2–8; treat any "phase 9" as launch hardening after billing).

- **Phase 2 (chat spikes).** Add a chat ingest module under `worker/src/twitch` using IRC and/or EventSub. Put shared spike types in `packages/shared`. Persist candidate moments through the existing BullMQ queues (`detect-spikes`). The Radar UI can then show a hype badge from the database or Redis, without embedding chat sockets in Next.js.
- **Phase 3 (clipping pipeline).** Implement `worker/src/media` with streamlink/yt-dlp and ffmpeg. Enqueue work from the web API layer (`apps/web/app/api` or a future `packages/jobs`). Store renders in R2 using credentials from the shared config. The Clip Queue page becomes a live list instead of a placeholder.
- **Phase 4 (captions and titles).** Fill in `worker/src/ai` (`transcribe.py` + `titles.ts`) using faster-whisper and a local or free-tier LLM. Reuse `packages/shared` types for transcripts and title packs.
- **Phase 5 (action-following crop, 10 streams).** Extend `worker/src/media/reframe.ts` and add concurrency limits from plan-aware config. No change to the Helix client besides perhaps watching more stream ids.
- **Phase 6 (YouTube import).** Add a `packages/youtube` (or worker module) for permitted VOD ingest. The `/import` page posts to a new route handler that enqueues a job. Reuse the same render pipeline as live clips.
- **Phase 7 (auto-post).** Add official destination clients (`packages/youtube` upload, later Meta and TikTok) called from `worker/src` publish jobs after Clip Queue approval. API review state lives in the database; the UI only reflects it.
- **Phase 8 (billing and launch).** Stripe webhooks in `apps/web/app/api`, plan gates in the server layer, and a move off Vercel Hobby before the first real charge. Worker and Helix code should not need to change.

Rules that stay true in every phase: official APIs only, a visible streamer credit on every clip (the auto worker has no approval gate, so the operator carries the copyright/DMCA risk of what they publish), media work stays in the worker (the owner's PC by default, a VPS only if chosen), and secrets never appear in logs, HTML, or git.
