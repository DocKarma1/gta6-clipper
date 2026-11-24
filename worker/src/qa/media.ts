import { spawn } from "node:child_process";

/** Format facts read with ffprobe. */
export type MediaFormat = {
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
};

/** Signal levels used by the highlight check. undefined = could not be measured. */
export type MediaSignals = {
  /** Loudest 400 ms momentary loudness (LUFS). */
  peakMomentaryLufs: number | undefined;
  /** Median momentary loudness over non-silent frames (LUFS). */
  medianMomentaryLufs: number | undefined;
  /** peak - median, in LU (≈ dB). */
  audioSpikeDb: number | undefined;
  /** Largest ffmpeg scene-change score (0-1). */
  maxSceneScore: number | undefined;
  /** Mean frame-to-frame scene score (0-1), a cheap motion proxy. */
  meanSceneScore: number | undefined;
};

/** Momentary loudness values from `ebur128=framelog=info` stderr. */
export function parseMomentaryLoudness(stderr: string): { t: number; m: number }[] {
  const out: { t: number; m: number }[] = [];
  const re = /t:\s*(-?[\d.]+)\s+TARGET:[^\n]*?M:\s*(-?[\d.]+)/gu;
  for (const match of stderr.matchAll(re)) {
    const t = Number(match[1]);
    const m = Number(match[2]);
    if (Number.isFinite(t) && Number.isFinite(m)) out.push({ t, m });
  }
  return out;
}

/** Peak, median, and spike (peak - median) from momentary loudness frames. */
export function summarizeLoudness(frames: { t: number; m: number }[]): {
  peak: number | undefined;
  median: number | undefined;
  spike: number | undefined;
} {
  // The first 0.4 s is a partial window; -70 LUFS and below is digital silence.
  const values = frames.filter((f) => f.t >= 0.4 && f.m > -70).map((f) => f.m);
  if (values.length === 0) return { peak: undefined, median: undefined, spike: undefined };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  const peak = sorted.at(-1) ?? median;
  return { peak, median, spike: Number((peak - median).toFixed(2)) };
}

/** Per-frame scene scores from `metadata=print:key=lavfi.scene_score` stderr. */
export function parseSceneScores(stderr: string): number[] {
  const out: number[] = [];
  for (const match of stderr.matchAll(/lavfi\.scene_score=([\d.]+)/gu)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

export function summarizeScenes(scores: number[]): {
  max: number | undefined;
  mean: number | undefined;
} {
  // Frame 0 always scores 0; it says nothing about motion.
  const values = scores.slice(1);
  if (values.length === 0) return { max: undefined, mean: undefined };
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    max: Number(Math.max(...values).toFixed(4)),
    mean: Number((sum / values.length).toFixed(4)),
  };
}

function runCapture(
  binary: string,
  args: string[],
  stream: "stdout" | "stderr",
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child[stream].on("data", (chunk: Buffer) => {
      text += chunk.toString();
      // Keep memory bounded on long files; summaries only need recent lines when huge.
      if (text.length > 8_000_000) text = text.slice(-8_000_000);
    });
    const other = stream === "stdout" ? child.stderr : child.stdout;
    other.on("data", () => undefined);
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => resolve(code === 0 ? text : undefined));
  });
}

/** ffprobe width/height/duration plus whether there is an audio stream. */
export async function probeFormat(filePath: string): Promise<MediaFormat | undefined> {
  const stdout = await runCapture(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height:format=duration",
      "-of",
      "json",
      filePath,
    ],
    "stdout",
  );
  if (!stdout) return undefined;
  try {
    const data = JSON.parse(stdout) as {
      streams?: { codec_type?: string; width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const video = data.streams?.find((s) => s.codec_type === "video");
    if (!video?.width || !video.height) return undefined;
    return {
      width: video.width,
      height: video.height,
      durationSeconds: Number(data.format?.duration ?? NaN),
      hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
    };
  } catch {
    return undefined;
  }
}

/** Two cheap ffmpeg passes: momentary loudness (ebur128) and scene scores at 320 px. */
export async function measureSignals(filePath: string, hasAudio = true): Promise<MediaSignals> {
  const [audio, video] = await Promise.all([
    hasAudio
      ? runCapture(
          "ffmpeg",
          [
            "-hide_banner",
            "-nostats",
            "-i",
            filePath,
            "-vn",
            "-af",
            "ebur128=framelog=info",
            "-f",
            "null",
            "-",
          ],
          "stderr",
        )
      : Promise.resolve(undefined),
    runCapture(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-i",
        filePath,
        "-an",
        "-vf",
        "scale=320:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score",
        "-f",
        "null",
        "-",
      ],
      "stderr",
    ),
  ]);
  const loud = audio ? summarizeLoudness(parseMomentaryLoudness(audio)) : undefined;
  const scenes = video ? summarizeScenes(parseSceneScores(video)) : undefined;
  return {
    peakMomentaryLufs: loud?.peak,
    medianMomentaryLufs: loud?.median,
    audioSpikeDb: loud?.spike,
    maxSceneScore: scenes?.max,
    meanSceneScore: scenes?.mean,
  };
}
