# Self-hosting on your own PC

Your own PC is the server for GTA 6 Clipper. The web app (Next.js) and the auto worker run on it
side by side. Supabase (login + Postgres) and Twitch Helix are the only cloud services. A rented
VPS is **optional**. You only need one if the PC can't stay on while streamers are live; it runs
the same commands.

> The worker has no permission gate. It clips watchlisted and top GTA VI streams automatically and
> puts the streamer credit on every clip. You carry the copyright/DMCA risk of what you publish.

## 1. Prerequisites

| Tool                   | Why                                          | Windows (PowerShell)                | macOS (Homebrew)           | Linux (Debian/Ubuntu)                                                                        |
| ---------------------- | -------------------------------------------- | ----------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| Node.js 22+            | web app + worker                             | `winget install OpenJS.NodeJS.LTS`  | `brew install node@22`     | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo bash - && sudo apt install nodejs` |
| ffmpeg 6+ (7.x tested) | capture muxing, cuts, render, loudness       | `winget install Gyan.FFmpeg`        | `brew install ffmpeg`      | `sudo apt install ffmpeg`                                                                    |
| Python 3.10+           | faster-whisper, facecam detector, streamlink | `winget install Python.Python.3.12` | `brew install python@3.12` | `sudo apt install python3 python3-venv`                                                      |
| Ollama                 | all AI text (hooks, titles, hashtags)        | `winget install Ollama.Ollama`      | `brew install ollama`      | `curl -fsSL https://ollama.com/install.sh \| sh`                                             |

Then, in the repo folder:

```bash
npm install

# Python venv with streamlink 8.6.3, faster-whisper and OpenCV
python3 -m venv .venv                                  # Windows: py -3.12 -m venv .venv
.venv/bin/pip install -r worker/requirements-python.txt  # Windows: .venv\Scripts\pip install -r worker\requirements-python.txt

# AI model for titles (about 2 GB)
ollama pull llama3.2:3b
```

The worker finds `.venv/bin/{python,streamlink}` (or `.venv\Scripts\*.exe` on Windows) by itself.
You can override them with `WHISPER_PYTHON` and `STREAMLINK_PATH`.

### Ollama model choices

| Model                        | RAM     | When to use it                         |
| ---------------------------- | ------- | -------------------------------------- |
| `llama3.2:3b` (default)      | ~3 GB   | Good English hooks, fast on CPU        |
| `qwen2.5:3b`                 | ~3 GB   | Better Swedish (`AI_LANGUAGE=sv`)      |
| `llama3.2:1b`                | ~1.5 GB | Low-RAM laptops; plainer copy          |
| `qwen2.5:7b` / `llama3.1:8b` | 6–8 GB  | Best copy, needs a strong CPU or a GPU |

Set `OLLAMA_MODEL` in `.env.local`. If Ollama is not running, the worker logs one warning and falls
back to built-in templates, so clips still render.

## 2. Configure `.env.local`

Copy `.env.example` to `.env.local` in the repo root. On macOS/Linux run `chmod 600 .env.local`.
Never commit it. Fill in:

- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (dev.twitch.tv app, client-credentials).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key) for login.
- Optional: `SUPABASE_SERVICE_ROLE_KEY` + `AUTO_WORKSPACE_ID` to make the worker write clips to
  Supabase. Without them it uses local SQLite (`data/clipper.sqlite`), which `/queue` reads.
- `OLLAMA_URL` (default `http://localhost:11434`), `OLLAMA_MODEL`, `AI_LANGUAGE` (`en`/`sv`).

The web app reads `apps/web/.env.local`, which is a symlink to the root file. On Windows, if
symlinks are not allowed, copy the file instead:
`copy .env.local apps\web\.env.local`.

In the Supabase dashboard (Authentication → URL Configuration), set the Site URL to
`http://localhost:3000` and add `http://localhost:3000/**` to the Redirect URLs. Magic links and
Twitch OAuth won't land correctly without this.

## 3. Run it

Use two terminals:

```bash
# Web app: production build is lighter than `npm run dev`
npm run build && npm run start --workspace=web      # http://localhost:3000

# Auto worker: watches up to 3 streams and renders clips to data/clips
npm run worker:auto
```

For a timed test, set `AUTO_RUN_SECONDS=600 npm run worker:auto`. The worker stops by itself.

Every rendered clip goes through the QA review gate: it is `ready` only if the highlight, title,
captions/credit, and format checks pass; otherwise it is `review` with the reasons. Check existing
clips with `npm run qa -- data/clips` (read-only). Thresholds and `QA_GATE=off` are in
`.env.example`; details in [QA_GATE.md](QA_GATE.md).

## 4. Autostart

The worker is safe to start at boot. It waits for the network and retries Helix and streamlink.

### Windows (Task Scheduler)

1. Create `start-clipper.cmd` in the repo folder:
   ```bat
   @echo off
   cd /d %~dp0
   start "clipper-web" /min cmd /c "npm run start --workspace=web >> data\web.log 2>&1"
   start "clipper-worker" /min cmd /c "npm run worker:auto >> data\worker.log 2>&1"
   ```
2. Task Scheduler → Create Task → Trigger **At log on** → Action: start `start-clipper.cmd` →
   Conditions: untick "Start only if on AC power" on laptops → Settings: "Restart every 1 minute,
   up to 3 times".
3. Power settings: set Sleep to **Never** while plugged in, or the PC will stop clipping.

### macOS (launchd)

Create `~/Library/LaunchAgents/se.gta6clipper.worker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>se.gta6clipper.worker</string>
  <key>WorkingDirectory</key><string>/Users/YOU/gta6-clipper</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/npm</string><string>run</string><string>worker:auto</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/YOU/gta6-clipper/data/worker.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/gta6-clipper/data/worker.log</string>
</dict></plist>
```

Load it with `launchctl load ~/Library/LaunchAgents/se.gta6clipper.worker.plist`. Make a second plist (label `se.gta6clipper.web`) that runs `npm run start --workspace=web` for the web app. To stop the Mac from sleeping, use
`caffeinate -s`, or System Settings → Energy → "Prevent automatic sleeping".

### Linux (systemd user service)

`~/.config/systemd/user/gta6-clipper-worker.service`:

```ini
[Unit]
Description=GTA 6 Clipper auto worker
After=network-online.target

[Service]
WorkingDirectory=%h/gta6-clipper
ExecStart=/usr/bin/npm run worker:auto
Restart=on-failure
RestartSec=10
Nice=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now gta6-clipper-worker
loginctl enable-linger "$USER"      # keep running after you log out
```

Add a second unit with `ExecStart=/usr/bin/npm run start --workspace=web` for the web app.

## 5. PC off, sleep or crash: what happens

- **While the PC is off nothing is clipped.** Live moments in that time are simply missed. Nothing
  is queued in the cloud.
- **No corrupt partial clips.** Renders are written to `*.partial.mp4` and renamed only when ffmpeg
  succeeds. Sidecar JSON files are written to a temp file and renamed.
- **On the next start the worker:**
  1. deletes leftover `*.partial.*` and `.src-*` scratch files in the clips folder;
  2. marks clips still in `rendering` as `failed` with "Interrupted";
  3. clears the old capture buffer, because those segments belong to an old session with an
     unknown time gap, and starts fresh streamlink sessions;
  4. re-reads the live directory and picks streams again.
- Finished clips (`.mp4` + `.json` + `.jpg`) stay in `data/clips` and in `/queue`.

## 6. Resource limits

Defaults are sized for a normal desktop (6–8 cores, 16 GB RAM):

| Setting                              | Default               | Notes                                                                              |
| ------------------------------------ | --------------------- | ---------------------------------------------------------------------------------- |
| `AUTO_TOP_K` / `AUTO_MAX_CONCURRENT` | 3 / 3                 | Hard cap is 3 streams. The Starter plan allows 2, so the effective cap is 2 there. |
| `AUTO_RENDER_CONCURRENCY`            | 1                     | One ffmpeg render at a time. Clips queue behind it.                                |
| `AUTO_STREAM_QUALITY`                | 1080p60 → 720p → best | Lower it to `720p60,720p,best` on a weak uplink.                                   |
| `AUTO_BUFFER_SECONDS`                | 150                   | About 150 s × 6–8 Mbit/s ≈ 110–150 MB disk per stream.                             |
| `AUTO_SPEECH_QUESTION_SECONDS`       | 30                    | Whisper `tiny` on ~35 s of audio, one stream at a time. Set 0 to turn it off.      |
| `RENDER_PRESET` / `RENDER_CRF`       | medium / 19           | `veryfast` cuts render CPU by ~2–3×, giving slightly bigger files.                 |

Rough load at 2–3 streams: about 6–8 Mbit/s download per 1080p60 stream, 1–2 cores for capture
and chat, short bursts of 4–8 cores per render (about 15–25 s for a 15–30 s clip on a modern CPU),
plus Ollama about 3 GB RAM while it writes titles. Keep at least 5 GB free disk for buffers and
clips.

## 7. Optional: a VPS instead

Use the same steps on a Linux VPS (systemd section). A 4 vCPU / 8 GB box handles 2–3 streams.
Costs are in [PROJECT_PLAN.md §12](PROJECT_PLAN.md#12-costs). Point the Supabase redirect URLs at
the VPS domain instead of localhost.
