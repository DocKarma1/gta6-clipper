import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLogger, type AutoSettings } from "@gta6-clipper/shared";

const log = getLogger("worker.capture");

export type BufferSegment = {
  path: string;
  session: string;
  index: number;
  /** Capture-clock start (epoch ms) of the segment. */
  startedAtMs: number;
  endedAtMs: number;
};

export type ExtractedWindow = {
  path: string;
  /** Seconds into the extracted file where the requested window starts. */
  offsetSeconds: number;
  /** Requested window length clamped to what the buffer actually covers. */
  durationSeconds: number;
  /** Capture-clock time (epoch ms) of the first frame in the extracted file. */
  fileStartMs: number;
  /** True when the buffer did not fully cover the requested window. */
  partial: boolean;
};

/** Parse ffmpeg's segment CSV list: "name,start,end" per line (seconds). */
export function parseSegmentList(csv: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  for (const line of csv.split("\n")) {
    const [name, start, end] = line.trim().split(",");
    const s = Number(start);
    const e = Number(end);
    if (name && Number.isFinite(s) && Number.isFinite(e) && e > s)
      out.push({ name, start: s, end: e });
  }
  return out;
}

/** Segments overlapping [startMs, endMs], with how much of the window they cover. */
export function pickSegments(
  segments: readonly BufferSegment[],
  startMs: number,
  endMs: number,
): { picked: BufferSegment[]; coveredFromMs: number; coveredToMs: number } {
  const sorted = [...segments].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const picked: BufferSegment[] = [];
  for (const segment of sorted) {
    if (segment.endedAtMs <= startMs || segment.startedAtMs >= endMs) continue;
    // Only contiguous segments from the same session can be stream-copied together.
    const last = picked.at(-1);
    if (
      last &&
      (last.session !== segment.session || segment.startedAtMs - last.endedAtMs > 1_500)
    ) {
      if (last.endedAtMs < endMs && segment.startedAtMs <= startMs + 1_000) {
        picked.length = 0;
      } else {
        break;
      }
    }
    picked.push(segment);
  }
  return {
    picked,
    coveredFromMs: Math.max(startMs, picked[0]?.startedAtMs ?? startMs),
    coveredToMs: Math.min(endMs, picked.at(-1)?.endedAtMs ?? startMs),
  };
}

/**
 * Rolling HLS buffer for one channel: streamlink -> ffmpeg segment muxer.
 *
 * - Quality: best available from AUTO_STREAM_QUALITY (1080p60 first).
 * - Timing: the capture clock starts at the first byte from streamlink, and
 *   segment boundaries come from ffmpeg's CSV segment list (segments are cut
 *   on keyframes, so their lengths vary; counting index x length drifts).
 * - Stability: streamlink is restarted with backoff while the channel is
 *   watched; each run is a new session so timestamps never collide.
 */
export class StreamCapture {
  private streamlink: ChildProcess | undefined;
  private ffmpeg: ChildProcess | undefined;
  private running = false;
  private session = "";
  private sessionStartMs: number | undefined;
  private readonly sessions = new Map<string, number>();
  private restartTimer: NodeJS.Timeout | undefined;
  private failures = 0;

  constructor(
    readonly channelLogin: string,
    private readonly settings: AutoSettings,
  ) {}

  get directory(): string {
    return path.join(this.settings.dataDir, "buffers", this.channelLogin);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Old segments have no reliable clock after a restart; start clean.
    await rm(this.directory, { recursive: true, force: true });
    await mkdir(this.directory, { recursive: true });
    this.spawnSession();
  }

  private spawnSession(): void {
    if (!this.running) return;
    this.session = `s${Date.now().toString(36)}`;
    this.sessionStartMs = undefined;
    const pattern = path.join(this.directory, `${this.session}_%05d.ts`);
    const listPath = path.join(this.directory, `${this.session}.csv`);
    const streamlink = spawn(
      this.settings.streamlinkPath,
      [
        "--stdout",
        "--loglevel",
        "warning",
        "--twitch-disable-ads",
        "--twitch-low-latency",
        "--stream-segment-attempts",
        "5",
        "--retry-open",
        "3",
        `https://www.twitch.tv/${this.channelLogin}`,
        this.settings.streamQuality,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-fflags",
        "+genpts+discardcorrupt",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-f",
        "segment",
        "-segment_time",
        String(this.settings.segmentSeconds),
        "-segment_list",
        listPath,
        "-segment_list_type",
        "csv",
        "-segment_list_flags",
        "+live",
        "-reset_timestamps",
        "1",
        "-segment_format",
        "mpegts",
        pattern,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    const session = this.session;
    streamlink.stdout?.once("data", () => {
      this.sessionStartMs = Date.now();
      this.sessions.set(session, this.sessionStartMs);
      this.failures = 0;
    });
    streamlink.stdout?.pipe(ffmpeg.stdin!);
    ffmpeg.stdin?.on("error", () => undefined);
    streamlink.stderr?.on("data", () => undefined);
    ffmpeg.stderr?.on("data", () => undefined);
    streamlink.on("exit", (code) => {
      ffmpeg.stdin?.end();
      if (!this.running) return;
      this.failures += 1;
      const backoffMs = Math.min(60_000, 2_000 * 2 ** Math.min(this.failures - 1, 5));
      log.warn(
        { channel: this.channelLogin, code, retryInMs: backoffMs },
        "streamlink exited; restarting the buffer",
      );
      this.restartTimer = setTimeout(() => this.spawnSession(), backoffMs);
    });
    this.streamlink = streamlink;
    this.ffmpeg = ffmpeg;
    log.info(
      { channel: this.channelLogin, quality: this.settings.streamQuality, session },
      "Started a rolling stream buffer",
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.streamlink?.kill("SIGTERM");
    this.ffmpeg?.stdin?.end();
    setTimeout(() => this.ffmpeg?.kill("SIGTERM"), 2_000).unref();
    this.streamlink = undefined;
  }

  async listSegments(): Promise<BufferSegment[]> {
    const out: BufferSegment[] = [];
    for (const [session, startMs] of this.sessions) {
      let csv = "";
      try {
        csv = await readFile(path.join(this.directory, `${session}.csv`), "utf8");
      } catch {
        continue;
      }
      // With -reset_timestamps, CSV start/end still count from the session start.
      for (const entry of parseSegmentList(csv)) {
        const index = Number(entry.name.replace(`${session}_`, "").replace(".ts", ""));
        out.push({
          path: path.join(this.directory, entry.name),
          session,
          index: Number.isFinite(index) ? index : 0,
          startedAtMs: startMs + entry.start * 1000,
          endedAtMs: startMs + entry.end * 1000,
        });
      }
    }
    return out.sort((a, b) => a.startedAtMs - b.startedAtMs);
  }

  /** Latest capture-clock time that is fully written to disk. */
  async bufferedUntilMs(): Promise<number | undefined> {
    return (await this.listSegments()).at(-1)?.endedAtMs;
  }

  async prune(): Promise<void> {
    const cutoff = Date.now() - this.settings.bufferSeconds * 1000;
    const segments = await this.listSegments();
    const stale = segments.filter((segment) => segment.endedAtMs < cutoff);
    await Promise.all(stale.map((segment) => rm(segment.path, { force: true })));
    let names: string[] = [];
    try {
      names = await readdir(this.directory);
    } catch {
      return;
    }
    // Drop sessions whose segments are all gone.
    for (const session of [...this.sessions.keys()]) {
      if (session === this.session) continue;
      if (!names.some((name) => name.startsWith(`${session}_`) && name.endsWith(".ts"))) {
        this.sessions.delete(session);
        await rm(path.join(this.directory, `${session}.csv`), { force: true });
      }
    }
  }

  /**
   * Stream-copy whole buffer segments covering [startMs, endMs] into one MP4.
   * Segments start on keyframes, so the copy is clean; the frame-accurate trim
   * happens in the render (offsetSeconds/durationSeconds).
   */
  async extractWindow(
    startMs: number,
    endMs: number,
    outputPath: string,
  ): Promise<ExtractedWindow | undefined> {
    const { picked, coveredFromMs, coveredToMs } = pickSegments(
      await this.listSegments(),
      startMs,
      endMs,
    );
    if (picked.length === 0 || coveredToMs - coveredFromMs < 3_000) {
      log.warn({ channel: this.channelLogin }, "The buffer does not cover the requested window");
      return undefined;
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    const listPath = `${outputPath}.concat.txt`;
    const list = picked
      .map((segment) => `file '${segment.path.replaceAll("'", "'\\''")}'`)
      .join("\n");
    await writeFile(listPath, list, "utf8");
    const ok = await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    await rm(listPath, { force: true });
    if (!ok) return undefined;
    const fileStartMs = picked[0]!.startedAtMs;
    return {
      path: outputPath,
      offsetSeconds: Math.max(0, (coveredFromMs - fileStartMs) / 1000),
      durationSeconds: (coveredToMs - coveredFromMs) / 1000,
      fileStartMs,
      partial: coveredFromMs > startMs + 500 || coveredToMs < endMs - 500,
    };
  }

  /** Mono 16 kHz WAV of the last `seconds` of buffered audio (for speech questions). */
  async extractRecentAudio(
    seconds: number,
    outputPath: string,
  ): Promise<{ path: string; fileStartMs: number } | undefined> {
    const until = await this.bufferedUntilMs();
    if (!until) return undefined;
    const { picked } = pickSegments(await this.listSegments(), until - seconds * 1000, until);
    if (picked.length === 0) return undefined;
    await mkdir(path.dirname(outputPath), { recursive: true });
    const listPath = `${outputPath}.concat.txt`;
    await writeFile(
      listPath,
      picked.map((segment) => `file '${segment.path.replaceAll("'", "'\\''")}'`).join("\n"),
      "utf8",
    );
    const ok = await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      outputPath,
    ]);
    await rm(listPath, { force: true });
    return ok ? { path: outputPath, fileStartMs: picked[0]!.startedAtMs } : undefined;
  }
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", () => undefined);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
