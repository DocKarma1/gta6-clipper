import {
  BLUR,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  RenderError,
  getBlurredBackgroundGeometry,
  getStackedSplitGeometry,
  type BlurredBackgroundGeometry,
  type BlurredBackgroundLayout,
  type SourceSize,
  type StackedSplitGeometry,
  type VerticalLayout,
} from "@gta6-clipper/shared";

export type LayoutFilterInput = {
  layout: VerticalLayout;
  source: SourceSize;
  frameWidth?: number;
  frameHeight?: number;
};

export type LayoutFilterGraph = {
  /** ffmpeg -filter_complex graph that writes a 1080x1920 stream to `outputLabel`. */
  filterComplex: string;
  outputLabel: string;
  videoWidth: number;
  videoHeight: number;
  geometry: StackedSplitGeometry | BlurredBackgroundGeometry;
};

const DEFAULT_SOURCE: SourceSize = { width: 1920, height: 1080 };

export function cropFilter({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  return `crop=${width}:${height}:${x}:${y}`;
}

function stackedSplitGraph(
  layout: Extract<VerticalLayout, { layout: "stacked-split" }>,
  source: SourceSize,
  width: number,
  height: number,
): LayoutFilterGraph {
  if (layout.facecam.width <= 0 || layout.facecam.height <= 0) {
    throw new RenderError(
      "stacked-split requires a facecam crop rect with a positive width and height.",
      {
        code: "RENDER_INVALID",
        statusCode: 400,
      },
    );
  }
  const geometry = getStackedSplitGeometry(layout, source, { width, height });
  const cam = geometry.facecamCrop;
  const game = geometry.gameplayCrop;
  const filterComplex = [
    "[0:v]split=2[camsrc][gamesrc]",
    `[camsrc]${cropFilter(cam)},scale=${width}:${geometry.facecamBandHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${geometry.facecamBandHeight},setsar=1[cam]`,
    `[gamesrc]${cropFilter(game)},scale=${width}:${geometry.gameplayHeight}:flags=lanczos,setsar=1[game]`,
    `[cam][game]vstack=inputs=2,format=yuv420p[vout]`,
  ].join(";");
  return {
    filterComplex,
    outputLabel: "vout",
    videoWidth: width,
    videoHeight: height,
    geometry,
  };
}

function blurredBackgroundGraph(
  layout: BlurredBackgroundLayout,
  width: number,
  height: number,
): LayoutFilterGraph {
  const geometry = getBlurredBackgroundGeometry({ width, height });
  const sigma = layout.blurSigma ?? BLUR.defaultSigma;
  if (!Number.isFinite(sigma) || sigma <= 0) {
    throw new RenderError("blurSigma must be a positive number.", {
      code: "RENDER_INVALID",
      statusCode: 400,
    });
  }
  const darken = layout.backgroundDarken ?? BLUR.defaultDarken;
  if (!Number.isFinite(darken) || darken < 0 || darken > 1) {
    throw new RenderError("backgroundDarken must be between 0 and 1.", {
      code: "RENDER_INVALID",
      statusCode: 400,
    });
  }
  const blurChain = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bilinear`,
    `crop=${width}:${height}`,
    `gblur=sigma=${sigma}`,
  ];
  if (darken > 0) {
    blurChain.push(`eq=brightness=${-darken}`);
  }
  blurChain.push("setsar=1[bgblur]");
  const filterComplex = [
    "[0:v]split=2[fg][bg]",
    `[bg]${blurChain.join(",")}`,
    `[fg]scale=${geometry.foregroundWidth}:${geometry.foregroundHeight}:flags=lanczos,setsar=1[fgsc]`,
    `[bgblur][fgsc]overlay=(W-w)/2:${geometry.foregroundY},format=yuv420p[vout]`,
  ].join(";");
  return {
    filterComplex,
    outputLabel: "vout",
    videoWidth: width,
    videoHeight: height,
    geometry,
  };
}

/**
 * Pure filter_complex builder for the two 9:16 layouts. Returns ffmpeg graph
 * fragments only — no process I/O — so it can be unit tested.
 */
export function buildVerticalLayoutFilter(input: LayoutFilterInput): LayoutFilterGraph {
  const source = input.source;
  if (source.width < 2 || source.height < 2) {
    throw new RenderError("Source width and height must be at least 2 pixels.", {
      code: "RENDER_INVALID",
      statusCode: 400,
    });
  }
  const width = input.frameWidth ?? FRAME_WIDTH;
  const height = input.frameHeight ?? FRAME_HEIGHT;
  if (input.layout.layout === "stacked-split") {
    return stackedSplitGraph(input.layout, source, width, height);
  }
  return blurredBackgroundGraph(input.layout, width, height);
}

export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll(":", "\\:")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

export type RenderArgsInput = {
  inputPath: string;
  outputPath: string;
  filterComplex: string;
  outputLabel: string;
  assPath?: string;
  fontsDir?: string;
  includeAudio?: boolean;
  /** Frame-accurate trim: seconds into the input where the clip starts. */
  trimStartSeconds?: number;
  /** Clip length in seconds. */
  durationSeconds?: number;
  /** Output frame rate; keep the source rate (30 or 60). */
  fps?: number;
  crf?: number;
  preset?: string;
  /** Audio filter chain (loudness, fades). */
  audioFilter?: string;
};

/** Round a probed frame rate to a standard output rate (keeps 30/60, caps at 60). */
export function normalizeFps(fps: number | undefined): number {
  if (!fps || !Number.isFinite(fps) || fps <= 0) return 30;
  const standard = [24, 25, 30, 50, 60];
  const nearest = standard.reduce((best, value) =>
    Math.abs(value - fps) < Math.abs(best - fps) ? value : best,
  );
  return Math.min(60, nearest);
}

/**
 * Audio chain: resample to 48 kHz with drift correction (keeps A/V sync),
 * loudness-normalise (two-pass values when measured), then short fades.
 */
export function buildAudioFilter(input: {
  durationSeconds: number;
  targetLufs: number;
  measured?: { i: number; tp: number; lra: number; thresh: number; offset: number } | undefined;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
}): string {
  const fadeIn = input.fadeInSeconds ?? 0.25;
  const fadeOut = input.fadeOutSeconds ?? 0.4;
  const base = `loudnorm=I=${input.targetLufs}:TP=-1.5:LRA=11`;
  const loudnorm = input.measured
    ? `${base}:measured_I=${input.measured.i}:measured_TP=${input.measured.tp}:measured_LRA=${input.measured.lra}:measured_thresh=${input.measured.thresh}:offset=${input.measured.offset}:linear=true`
    : base;
  const outStart = Math.max(0, input.durationSeconds - fadeOut).toFixed(3);
  return [
    "aresample=48000:async=1:first_pts=0",
    loudnorm,
    "aresample=48000",
    `afade=t=in:st=0:d=${fadeIn}`,
    `afade=t=out:st=${outStart}:d=${fadeOut}`,
  ].join(",");
}

/** Parse the JSON block loudnorm prints with print_format=json. */
export function parseLoudnormJson(
  stderr: string,
): { i: number; tp: number; lra: number; thresh: number; offset: number } | undefined {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const data = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
    const values = {
      i: Number(data.input_i),
      tp: Number(data.input_tp),
      lra: Number(data.input_lra),
      thresh: Number(data.input_thresh),
      offset: Number(data.target_offset),
    };
    if (Object.values(values).some((value) => !Number.isFinite(value))) return undefined;
    // Silent input reports -inf; skip two-pass values then.
    if (values.i < -70) return undefined;
    return values;
  } catch {
    return undefined;
  }
}

/**
 * Full ffmpeg argv (without the binary) for a layout render, optionally burning
 * an ASS subtitle file onto the layout output.
 *
 * Quality defaults: libx264 CRF 19, preset medium, High profile, yuv420p with
 * BT.709 tags, constant source frame rate, 2 s GOP, AAC 192 kb/s 48 kHz,
 * faststart. Input-side -ss/-t with re-encoding gives frame-accurate cuts.
 */
export function buildRenderArgs(input: RenderArgsInput): string[] {
  let filterComplex = input.filterComplex;
  let mapLabel = input.outputLabel;
  if (input.assPath) {
    const escaped = escapeFfmpegFilterPath(input.assPath);
    const fonts = input.fontsDir ? `:fontsdir=${escapeFfmpegFilterPath(input.fontsDir)}` : "";
    filterComplex = `${filterComplex};[${input.outputLabel}]ass=filename=${escaped}${fonts}[vsub]`;
    mapLabel = "vsub";
  }
  const fps = normalizeFps(input.fps);
  const args = ["-hide_banner", "-y"];
  if (input.trimStartSeconds !== undefined && input.trimStartSeconds > 0) {
    args.push("-ss", input.trimStartSeconds.toFixed(3));
  }
  if (input.durationSeconds !== undefined && input.durationSeconds > 0) {
    args.push("-t", input.durationSeconds.toFixed(3));
  }
  args.push("-i", input.inputPath, "-filter_complex", filterComplex, "-map", `[${mapLabel}]`);
  if (input.includeAudio !== false) {
    args.push("-map", "0:a?");
    if (input.audioFilter) args.push("-af", input.audioFilter);
    args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  } else {
    args.push("-an");
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    input.preset ?? "medium",
    "-crf",
    String(input.crf ?? 19),
    "-profile:v",
    "high",
    "-level:v",
    fps > 30 ? "4.2" : "4.0",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-fps_mode",
    "cfr",
    "-g",
    String(fps * 2),
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
    "-movflags",
    "+faststart",
    "-shortest",
    input.outputPath,
  );
  return args;
}

export { DEFAULT_SOURCE };
