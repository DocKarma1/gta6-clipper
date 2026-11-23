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
    `[camsrc]${cropFilter(cam)},scale=${width}:${geometry.facecamBandHeight}:force_original_aspect_ratio=increase,crop=${width}:${geometry.facecamBandHeight},setsar=1[cam]`,
    `[gamesrc]${cropFilter(game)},scale=${width}:${geometry.gameplayHeight},setsar=1[game]`,
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
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
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
    `[fg]scale=${geometry.foregroundWidth}:${geometry.foregroundHeight},setsar=1[fgsc]`,
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
};

/**
 * Full ffmpeg argv (without the binary) for a layout render, optionally burning
 * an ASS subtitle file onto the layout output.
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
  const args = [
    "-hide_banner",
    "-y",
    "-i",
    input.inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    `[${mapLabel}]`,
  ];
  if (input.includeAudio !== false) {
    args.push("-map", "0:a?", "-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-an");
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    input.outputPath,
  );
  return args;
}

export { DEFAULT_SOURCE };
