import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLogger, type AutoSettings } from "@gta6-clipper/shared";

const log = getLogger("worker.capture");

export type BufferSegment = {
  path: string;
  index: number;
  startedAtMs: number;
};

export class StreamCapture {
  private streamlink: ChildProcess | undefined;
  private ffmpeg: ChildProcess | undefined;
  private startedAtMs = 0;
  private running = false;

  constructor(
    readonly channelLogin: string,
    private readonly settings: AutoSettings,
  ) {}

  get directory(): string {
    return path.join(this.settings.dataDir, "buffers", this.channelLogin);
  }

  async start(): Promise<void> {
    if (this.running) return;
    await mkdir(this.directory, { recursive: true });
    this.running = true;
    this.startedAtMs = Date.now();
    const pattern = path.join(this.directory, "seg_%05d.ts");
    this.streamlink = spawn(
      this.settings.streamlinkPath,
      [
        "--stdout",
        "--loglevel",
        "warning",
        "--twitch-disable-ads",
        `https://www.twitch.tv/${this.channelLogin}`,
        "720p,720p60,best",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-c",
        "copy",
        "-f",
        "segment",
        "-segment_time",
        String(this.settings.segmentSeconds),
        "-reset_timestamps",
        "1",
        "-segment_format",
        "mpegts",
        pattern,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    this.streamlink.stdout?.pipe(this.ffmpeg.stdin!);
    this.streamlink.stderr?.on("data", () => undefined);
    this.ffmpeg.stderr?.on("data", () => undefined);
    this.streamlink.on("exit", () => {
      if (this.running) log.warn({ channel: this.channelLogin }, "streamlink exited");
    });
    log.info({ channel: this.channelLogin }, "Started a rolling stream buffer");
  }

  async stop(): Promise<void> {
    this.running = false;
    this.streamlink?.kill("SIGTERM");
    this.ffmpeg?.kill("SIGTERM");
    this.streamlink = undefined;
    this.ffmpeg = undefined;
  }

  async listSegments(): Promise<BufferSegment[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.directory)).filter((name) => name.endsWith(".ts")).sort();
    } catch {
      return [];
    }
    return names.map((name) => {
      const index = Number(name.replace("seg_", "").replace(".ts", ""));
      return {
        path: path.join(this.directory, name),
        index: Number.isFinite(index) ? index : 0,
        startedAtMs:
          this.startedAtMs +
          (Number.isFinite(index) ? index : 0) * this.settings.segmentSeconds * 1000,
      };
    });
  }

  async prune(): Promise<void> {
    const keep = Math.ceil(this.settings.bufferSeconds / this.settings.segmentSeconds) + 2;
    const segments = await this.listSegments();
    const stale = segments.slice(0, Math.max(0, segments.length - keep));
    await Promise.all(stale.map((segment) => rm(segment.path, { force: true })));
  }

  /**
   * Concatenate buffer segments that overlap [startMs, endMs] into a single MP4.
   */
  async extractWindow(startMs: number, endMs: number, outputPath: string): Promise<boolean> {
    const segments = await this.listSegments();
    const overlapping = segments.filter((segment) => {
      const segmentEnd = segment.startedAtMs + this.settings.segmentSeconds * 1000;
      return segment.startedAtMs <= endMs && segmentEnd >= startMs;
    });
    if (overlapping.length === 0) {
      log.warn({ channel: this.channelLogin }, "No buffer segments overlap the requested window");
      return false;
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    const listPath = `${outputPath}.concat.txt`;
    const list = overlapping
      .map((segment) => `file '${segment.path.replaceAll("'", "'\\''")}'`)
      .join("\n");
    await writeFile(listPath, list, "utf8");
    const ss = Math.max(0, (startMs - (overlapping[0]?.startedAtMs ?? startMs)) / 1000);
    const duration = Math.max(0.5, (endMs - startMs) / 1000);
    return runFfmpeg([
      "-hide_banner",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-ss",
      ss.toFixed(2),
      "-t",
      duration.toFixed(2),
      "-c",
      "copy",
      outputPath,
    ]);
  }
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
