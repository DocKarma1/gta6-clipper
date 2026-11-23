import { spawn } from "node:child_process";
import { mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  RenderError,
  getLogger,
  type SourceSize,
  type StreamerCredit,
  type TimedWord,
  type VerticalLayout,
} from "@gta6-clipper/shared";
import { buildAssDocument, defaultFontsDir } from "../media/ass";
import { parseSceneCuts, parseSilenceDetect } from "../detect/highlight";
import {
  buildAudioFilter,
  buildRenderArgs,
  buildVerticalLayoutFilter,
  normalizeFps,
  parseLoudnormJson,
} from "../media/layouts";

const log = getLogger("worker.render");

export type RenderJob = {
  inputPath: string;
  outputPath: string;
  layout: VerticalLayout;
  words: readonly TimedWord[];
  credit: StreamerCredit;
  durationSeconds: number;
  source?: SourceSize;
  ffmpegPath?: string;
  fontsDir?: string;
  includeAudio?: boolean;
  assOutputPath?: string;
  /** Seconds into inputPath where the clip starts (frame-accurate). */
  trimStartSeconds?: number;
  fps?: number;
  crf?: number;
  preset?: string;
  /** Integrated loudness target; default -14 LUFS. */
  targetLufs?: number;
};

export type RenderResult = {
  assPath: string;
  outputPath: string;
  fps: number;
  bytes: number;
  /** Loudness measured on the source window before normalisation. */
  sourceLufs: number | undefined;
};

export async function renderVerticalShort(job: RenderJob): Promise<RenderResult> {
  if (!job.inputPath || !job.outputPath) {
    throw new RenderError("A render job needs an inputPath and an outputPath.", {
      code: "RENDER_INVALID",
      statusCode: 400,
    });
  }
  if (!Number.isFinite(job.durationSeconds) || job.durationSeconds <= 0) {
    throw new RenderError("A render job needs a positive durationSeconds.", {
      code: "RENDER_INVALID",
      statusCode: 400,
    });
  }

  const probed = job.source && job.fps ? undefined : await probeVideo(job.inputPath);
  const source = job.source ?? probed?.size ?? (await probeSourceSize(job.inputPath));
  const fps = normalizeFps(job.fps ?? probed?.fps);
  const includeAudio = job.includeAudio !== false;
  const targetLufs = job.targetLufs ?? -14;
  const measured = includeAudio
    ? await measureLoudness(
        job.inputPath,
        job.trimStartSeconds ?? 0,
        job.durationSeconds,
        targetLufs,
      )
    : undefined;
  const graph = buildVerticalLayoutFilter({ layout: job.layout, source });
  const ass = buildAssDocument({
    layout: job.layout,
    words: job.words,
    credit: job.credit,
    durationSeconds: job.durationSeconds,
    source,
  });
  const assPath =
    job.assOutputPath ??
    path.join(await mkdtemp(path.join(tmpdir(), "clipper-ass-")), "captions.ass");
  await writeFile(assPath, ass, "utf8");

  const partialPath = job.outputPath.replace(/\.mp4$/u, ".partial.mp4");
  const args = buildRenderArgs({
    inputPath: job.inputPath,
    outputPath: partialPath,
    filterComplex: graph.filterComplex,
    outputLabel: graph.outputLabel,
    assPath,
    fontsDir: job.fontsDir ?? defaultFontsDir(),
    includeAudio,
    ...(job.trimStartSeconds !== undefined ? { trimStartSeconds: job.trimStartSeconds } : {}),
    durationSeconds: job.durationSeconds,
    fps,
    ...(job.crf !== undefined ? { crf: job.crf } : {}),
    ...(job.preset !== undefined ? { preset: job.preset } : {}),
    ...(includeAudio
      ? {
          audioFilter: buildAudioFilter({
            durationSeconds: job.durationSeconds,
            targetLufs,
            measured,
          }),
        }
      : {}),
  });

  log.info(
    {
      layout: job.layout.layout,
      outputPath: job.outputPath,
      wordCount: job.words.length,
      videoWidth: graph.videoWidth,
      videoHeight: graph.videoHeight,
    },
    "Rendering a vertical short",
  );

  try {
    await runFfmpeg(job.ffmpegPath ?? "ffmpeg", args);
    // Publish atomically so a crash never leaves a half-written clip under the final name.
    await rename(partialPath, job.outputPath);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
  const bytes = (await stat(job.outputPath)).size;
  return { assPath, outputPath: job.outputPath, fps, bytes, sourceLufs: measured?.i };
}

/** First pass of two-pass loudnorm on the trimmed window. */
export async function measureLoudness(
  inputPath: string,
  startSeconds: number,
  durationSeconds: number,
  targetLufs = -14,
): Promise<ReturnType<typeof parseLoudnormJson>> {
  const stderr = await runFfmpegCapture([
    "-hide_banner",
    "-nostats",
    "-ss",
    startSeconds.toFixed(3),
    "-t",
    durationSeconds.toFixed(3),
    "-i",
    inputPath,
    "-vn",
    "-af",
    `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:print_format=json`,
    "-f",
    "null",
    "-",
  ]);
  return stderr ? parseLoudnormJson(stderr) : undefined;
}

/** Integrated loudness (LUFS) of a finished file, via ebur128. */
export async function measureIntegratedLufs(filePath: string): Promise<number | undefined> {
  const stderr = await runFfmpegCapture([
    "-hide_banner",
    "-nostats",
    "-i",
    filePath,
    "-vn",
    "-af",
    "ebur128=framelog=quiet",
    "-f",
    "null",
    "-",
  ]);
  const match = stderr
    ? /I:\s*(-?[\d.]+)\s*LUFS/u.exec(stderr.slice(stderr.lastIndexOf("Summary")))
    : null;
  return match ? Number(match[1]) : undefined;
}

/**
 * Silences and scene cuts in [startSeconds, startSeconds + durationSeconds]
 * of the input, in seconds relative to the input file. One cheap pass at a
 * reduced resolution.
 */
export async function detectCutHints(
  inputPath: string,
  startSeconds: number,
  durationSeconds: number,
): Promise<{ silences: { start: number; end: number }[]; sceneCuts: number[] }> {
  const stderr = await runFfmpegCapture([
    "-hide_banner",
    "-nostats",
    "-ss",
    startSeconds.toFixed(3),
    "-t",
    durationSeconds.toFixed(3),
    "-i",
    inputPath,
    "-filter_complex",
    "[0:v]scale=320:-2,select='gt(scene,0.32)',showinfo[v];[0:a]silencedetect=n=-32dB:d=0.35[a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-f",
    "null",
    "-",
  ]);
  if (!stderr) return { silences: [], sceneCuts: [] };
  return {
    silences: parseSilenceDetect(stderr).map((item) => ({
      start: item.start + startSeconds,
      end: item.end + startSeconds,
    })),
    sceneCuts: parseSceneCuts(stderr).map((at) => at + startSeconds),
  };
}

export async function probeVideo(
  filePath: string,
): Promise<
  { size: SourceSize; fps: number | undefined; duration: number | undefined } | undefined
> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,avg_frame_rate,r_frame_rate:format=duration",
      "-of",
      "json",
      filePath,
    ]);
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", () => undefined);
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      if (code !== 0) return resolve(undefined);
      try {
        const data = JSON.parse(stdout) as {
          streams?: {
            width?: number;
            height?: number;
            avg_frame_rate?: string;
            r_frame_rate?: string;
          }[];
          format?: { duration?: string };
        };
        const stream = data.streams?.[0];
        if (!stream?.width || !stream.height) return resolve(undefined);
        const rate = (value?: string) => {
          const [n, d] = (value ?? "").split("/").map(Number);
          return n && d ? n / d : undefined;
        };
        const fps = rate(stream.avg_frame_rate) ?? rate(stream.r_frame_rate);
        const duration = Number(data.format?.duration);
        resolve({
          size: { width: stream.width, height: stream.height },
          fps,
          duration: Number.isFinite(duration) ? duration : undefined,
        });
      } catch {
        resolve(undefined);
      }
    });
  });
}

function runFfmpegCapture(args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 400_000) stderr = stderr.slice(-400_000);
    });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => resolve(code === 0 ? stderr : undefined));
  });
}

async function probeSourceSize(filePath: string): Promise<SourceSize> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
      filePath,
    ]);
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", () => {
      // Discard stderr; a missing size is reported below.
    });
    child.on("error", (error) => {
      reject(
        new RenderError("ffprobe could not be started.", { code: "RENDER_FAILED", cause: error }),
      );
    });
    child.on("close", (code) => {
      const match = /^(\d+)x(\d+)/.exec(stdout.trim());
      if (code !== 0 || !match) {
        reject(
          new RenderError("Could not read the source video size.", {
            code: "RENDER_FAILED",
          }),
        );
        return;
      }
      resolve({ width: Number(match[1]), height: Number(match[2]) });
    });
  });
}

function runFfmpeg(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    child.on("error", (error) => {
      reject(
        new RenderError("ffmpeg could not be started.", {
          code: "RENDER_FAILED",
          cause: error,
        }),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const hint = stderr.trim().split("\n").slice(-8).join(" ").slice(0, 500);
      reject(
        new RenderError(`ffmpeg exited with code ${code ?? "unknown"}${hint ? `: ${hint}` : "."}`, {
          code: "RENDER_FAILED",
        }),
      );
    });
  });
}

/** @deprecated Use renderVerticalShort with a typed layout option. */
export async function renderShort(input: {
  videoPath: string;
  transcriptPath: string;
  style: string;
  outputPath: string;
}): Promise<void> {
  void input;
  throw new RenderError(
    "renderShort is deprecated. Use renderVerticalShort({ layout, words, credit }).",
    {
      code: "RENDER_INVALID",
      statusCode: 400,
    },
  );
}
