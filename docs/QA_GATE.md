# QA review gate

No clip becomes `ready` (or publishable) unless it passes four checks. A clip that fails any
check gets status `review` instead, with the failed checks and reasons stored in its sidecar JSON
(`qa`, `status`) and in the database (`clips.qa`, `clips.status`, plus a short
`error_message` starting with `QA review:`). Nothing is published by the gate.

Code: `worker/src/qa/` (hooked in after the render in `worker/src/auto/clip-job.ts`).

## Status flow

```
rendering ──render ok──▶ QA gate ──all pass──▶ ready   (publishable)
    │                        └────any fail──▶ review  (held; reasons in qa / error_message)
    └──render error──▶ failed
```

- `QA_GATE=off`: clips go straight to `ready`, but `qa.enabled=false` makes them unpublishable.
- Publishing: `publishClip()` / every adapter in `worker/src/post/adapters.ts` returns
  `status: "blocked"` unless the clip is `ready` **and** `qa.enabled && qa.passed`. The migration
  adds the same rule as a database trigger on `posts` (queued/posted rows).

## Checks and defaults (all configurable in `.env.local`)

| Check     | Passes when                                                                                                     | Settings (default)                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| highlight | at least N of 3 signals: speech, audio spike, visual change                                                     | `QA_HIGHLIGHT_MIN_SIGNALS` (2)                                                                                                                |
|           | speech: meaningful (non-filler) words and words/second                                                          | `QA_MIN_MEANINGFUL_WORDS` (5), `QA_MIN_SPEECH_WPS` (0.6)                                                                                      |
|           | audio: loudest 400 ms momentary loudness (ffmpeg `ebur128`) above the clip median                               | `QA_MIN_AUDIO_SPIKE_DB` (6)                                                                                                                   |
|           | visual: max ffmpeg scene score, or mean frame-to-frame score as motion                                          | `QA_MIN_SCENE_SCORE` (0.3), `QA_MIN_MOTION_SCORE` (0.02)                                                                                      |
| title     | every copy pack has `source: "llm"` (no template fallback)                                                      | —                                                                                                                                             |
|           | title + hook keywords (minus stopwords, GTA/clip filler, streamer name) found in the transcript                 | `QA_MIN_TITLE_OVERLAP` (0.3)                                                                                                                  |
|           | Ollama answers `{"grounded": true}` (same `OLLAMA_URL`/`OLLAMA_MODEL`); unreachable, slow, or bad JSON = review | `QA_OLLAMA_CHECK` (on)                                                                                                                        |
| captions  | `.ass` file next to the clip with enough phrase cues                                                            | `QA_MIN_CAPTION_CUES` (2)                                                                                                                     |
|           | readable cues: line length, line count; timing/reading speed (fails if > 25% of cues are off)                   | `QA_MAX_CAPTION_LINE_CHARS` (32), `QA_MAX_CAPTION_LINES` (2), `QA_MIN_CUE_SECONDS` (0.3), `QA_MAX_CUE_SECONDS` (7), `QA_MAX_CAPTION_CPS` (25) |
|           | caption, hook, and credit boxes inside the platform safe area (right 12%, bottom 15% reserved)                  | —                                                                                                                                             |
|           | burned-in credit is `twitch.tv/<channel>`; description or sidecar credit names the channel                      | —                                                                                                                                             |
| format    | ffprobe: duration and resolution                                                                                | `QA_MIN_SECONDS` (12), `QA_MAX_SECONDS` (35), `QA_WIDTH` (1080), `QA_HEIGHT` (1920)                                                           |

A check that cannot run (missing file, ffmpeg error, Ollama down) fails, so the clip goes to
review rather than ready.

## Run it on existing clips

```bash
npm run qa -- data/clips                 # every clip in the folder, read-only report
npm run qa -- data/clips/<name>.mp4      # one clip (or its .json sidecar)
npm run qa -- 9312694b                   # clip id or the 8-char id in the filename
npm run qa -- data/clips --no-ollama     # skip the Ollama grounding question
npm run qa -- data/clips --write         # also store qa + status in each sidecar (local files only)
```

Exit code 0 = all ready, 1 = some need review, 2 = nothing found / usage error. The CLI never
writes to Supabase. Clips rendered before this change have no `.ass` caption file, so their
captions check reports "no caption file"; new renders keep `<name>.ass` next to the MP4.

## Database migration

`supabase/migrations/20261124010000_clip_qa_review.sql` (additive): adds `clips.qa jsonb`,
widens `clips_status_check` to include `review`, adds an index on `(status, created_at)`, and a
trigger that refuses `queued`/`posted` posts for clips that are not `ready` with a passed QA
result. It is not applied automatically. Apply it with `supabase db push` from a linked checkout,
or paste it into the Supabase SQL editor. Until it is applied, the worker stores `review` clips in
Supabase as `failed` with the QA reasons in `error_message` (never `ready`); local SQLite needs
no migration.
