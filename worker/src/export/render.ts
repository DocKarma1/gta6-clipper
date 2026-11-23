import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
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
import { buildRenderArgs, buildVerticalLayoutFilter } from "../media/layouts";

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
};

export async function renderVerticalShort(
  job: RenderJob,
): Promise<{ assPath: string; outputPath: string }> {
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

  const source = job.source ?? (await probeSourceSize(job.inputPath));
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

  const args = buildRenderArgs({
    inputPath: job.inputPath,
    outputPath: job.outputPath,
    filterComplex: graph.filterComplex,
    outputLabel: graph.outputLabel,
    assPath,
    fontsDir: job.fontsDir ?? defaultFontsDir(),
    ...(job.includeAudio === undefined ? {} : { includeAudio: job.includeAudio }),
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

  await runFfmpeg(job.ffmpegPath ?? "ffmpeg", args);
  return { assPath, outputPath: job.outputPath };
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
