/**
 * Shared geometry for 9:16 Shorts. Every text overlay (captions, hook title,
 * and streamer credit) must stay inside the safe zone so platform UI in the
 * bottom 15% and right 12% of the frame does not cover it.
 */

export const FRAME_WIDTH = 1080;
export const FRAME_HEIGHT = 1920;

export const SAFE_ZONE = {
  /** Fraction of the frame height reserved at the bottom (platform UI). */
  bottomFraction: 0.15,
  /** Fraction of the frame width reserved on the right (platform UI). */
  rightFraction: 0.12,
} as const;

export const FACECAM_BAND = {
  minFraction: 0.3,
  maxFraction: 0.4,
  defaultFraction: 0.35,
} as const;

export const BLUR = {
  defaultSigma: 20,
  defaultDarken: 0.3,
} as const;

export const TEXT = {
  padding: 32,
  captionFontSize: 84,
  titleFontSize: 64,
  creditFontSize: 36,
  captionMaxLines: 3,
  captionLineHeight: 102,
  titleLineHeight: 80,
  creditLineHeight: 48,
  fontName: "DejaVu Sans",
} as const;

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SourceSize = {
  width: number;
  height: number;
};

export type FrameSize = {
  width: number;
  height: number;
};

export type VerticalLayoutId = "stacked-split" | "blurred-background";

export type CreditFormat = "twitch.tv" | "at";

export type StreamerCredit = {
  login: string;
  format?: CreditFormat;
};

export type StackedSplitLayout = {
  layout: "stacked-split";
  facecam: CropRect;
  /** Top band as a fraction of output height. Must be between 0.30 and 0.40. */
  facecamBandFraction?: number;
  /** Horizontal shift of the gameplay crop window, in source pixels. */
  gameplayXOffset?: number;
};

export type BlurredBackgroundLayout = {
  layout: "blurred-background";
  hookTitle: string;
  /** 0 (no darken) to 1 (fully darkened). */
  backgroundDarken?: number;
  blurSigma?: number;
};

export type VerticalLayout = StackedSplitLayout | BlurredBackgroundLayout;

export type SafeZone = {
  left: number;
  top: number;
  /** First x coordinate that is outside the safe zone (exclusive). */
  right: number;
  /** First y coordinate that is outside the safe zone (exclusive). */
  bottom: number;
  width: number;
  height: number;
  insetRight: number;
  insetBottom: number;
};

export type TextAlign = "top-center" | "bottom-center" | "bottom-left" | "top-left";

export type TextAnchor = {
  x: number;
  y: number;
  align: TextAlign;
  maxWidth: number;
  maxHeight: number;
};

export type TextPlacement = {
  caption: TextAnchor;
  title: TextAnchor | undefined;
  credit: TextAnchor;
};

export type StackedSplitGeometry = {
  facecamBandHeight: number;
  gameplayHeight: number;
  seamY: number;
  facecamCrop: CropRect;
  gameplayCrop: CropRect;
};

export type BlurredBackgroundGeometry = {
  foregroundWidth: number;
  foregroundHeight: number;
  foregroundY: number;
  topBlurHeight: number;
  bottomBlurHeight: number;
};

export function even(value: number): number {
  return Math.round(value / 2) * 2;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getSafeZone(
  frame: FrameSize = { width: FRAME_WIDTH, height: FRAME_HEIGHT },
): SafeZone {
  const insetRight = Math.round(frame.width * SAFE_ZONE.rightFraction);
  const insetBottom = Math.round(frame.height * SAFE_ZONE.bottomFraction);
  const right = frame.width - insetRight;
  const bottom = frame.height - insetBottom;
  return {
    left: 0,
    top: 0,
    right,
    bottom,
    width: right,
    height: bottom,
    insetRight,
    insetBottom,
  };
}

export function isInsideSafeZone(
  box: { x: number; y: number; width: number; height: number },
  zone: SafeZone = getSafeZone(),
): boolean {
  return (
    box.x >= zone.left &&
    box.y >= zone.top &&
    box.x + box.width <= zone.right &&
    box.y + box.height <= zone.bottom
  );
}

export function anchorBounds(anchor: TextAnchor): {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
} {
  let x = anchor.x;
  let y = anchor.y;
  if (anchor.align === "top-center" || anchor.align === "bottom-center") {
    x = anchor.x - anchor.maxWidth / 2;
  }
  if (anchor.align === "bottom-center" || anchor.align === "bottom-left") {
    y = anchor.y - anchor.maxHeight;
  }
  return {
    x,
    y,
    width: anchor.maxWidth,
    height: anchor.maxHeight,
    right: x + anchor.maxWidth,
    bottom: y + anchor.maxHeight,
  };
}

export function formatStreamerCredit(credit: StreamerCredit): string {
  const login = credit.login.trim().replace(/^@+/u, "");
  if (!login) {
    return "";
  }
  return credit.format === "at" ? `@${login}` : `twitch.tv/${login}`;
}

export function resolveFacecamBandFraction(fraction: number | undefined): number {
  const value = fraction ?? FACECAM_BAND.defaultFraction;
  if (
    !Number.isFinite(value) ||
    value < FACECAM_BAND.minFraction ||
    value > FACECAM_BAND.maxFraction
  ) {
    throw new RangeError(
      `facecamBandFraction must be between ${FACECAM_BAND.minFraction} and ${FACECAM_BAND.maxFraction}.`,
    );
  }
  return value;
}

export function facecamBandHeight(
  fraction: number | undefined = FACECAM_BAND.defaultFraction,
  frameHeight: number = FRAME_HEIGHT,
): number {
  const resolved = resolveFacecamBandFraction(fraction);
  const minBand = even(frameHeight * FACECAM_BAND.minFraction);
  const maxBand = even(frameHeight * FACECAM_BAND.maxFraction);
  let band = even(frameHeight * resolved);
  band = clamp(band, minBand, maxBand);
  if ((frameHeight - band) % 2 !== 0) {
    band = band + 1 <= maxBand ? band + 1 : band - 1;
  }
  return band;
}

function clampCrop(rect: CropRect, source: SourceSize): CropRect {
  const width = Math.max(2, even(Math.min(rect.width, source.width)));
  const height = Math.max(2, even(Math.min(rect.height, source.height)));
  const x = even(clamp(rect.x, 0, Math.max(0, source.width - width)));
  const y = even(clamp(rect.y, 0, Math.max(0, source.height - height)));
  return { x, y, width, height };
}

export function gameplayCenterCrop(
  source: SourceSize,
  output: FrameSize,
  xOffset: number = 0,
): CropRect {
  const aspect = output.width / output.height;
  let cropWidth: number;
  let cropHeight: number;
  if (source.width / source.height >= aspect) {
    cropHeight = source.height;
    cropWidth = cropHeight * aspect;
  } else {
    cropWidth = source.width;
    cropHeight = cropWidth / aspect;
  }
  cropWidth = Math.max(2, even(cropWidth));
  cropHeight = Math.max(2, even(cropHeight));
  cropWidth = Math.min(cropWidth, even(source.width));
  cropHeight = Math.min(cropHeight, even(source.height));
  const x = even(clamp((source.width - cropWidth) / 2 + xOffset, 0, source.width - cropWidth));
  const y = even(clamp((source.height - cropHeight) / 2, 0, source.height - cropHeight));
  return { x, y, width: cropWidth, height: cropHeight };
}

export function getStackedSplitGeometry(
  layout: StackedSplitLayout,
  source: SourceSize,
  frame: FrameSize = { width: FRAME_WIDTH, height: FRAME_HEIGHT },
): StackedSplitGeometry {
  const band = facecamBandHeight(layout.facecamBandFraction, frame.height);
  const gameplayHeight = frame.height - band;
  const gameplayCrop = gameplayCenterCrop(
    source,
    { width: frame.width, height: gameplayHeight },
    layout.gameplayXOffset ?? 0,
  );
  return {
    facecamBandHeight: band,
    gameplayHeight,
    seamY: band,
    facecamCrop: clampCrop(layout.facecam, source),
    gameplayCrop,
  };
}

export function sixteenNineHeight(width: number): number {
  return even((width * 9) / 16);
}

export function getBlurredBackgroundGeometry(
  frame: FrameSize = { width: FRAME_WIDTH, height: FRAME_HEIGHT },
): BlurredBackgroundGeometry {
  const foregroundWidth = frame.width;
  const foregroundHeight = sixteenNineHeight(foregroundWidth);
  const foregroundY = even((frame.height - foregroundHeight) / 2);
  return {
    foregroundWidth,
    foregroundHeight,
    foregroundY,
    topBlurHeight: foregroundY,
    bottomBlurHeight: frame.height - foregroundY - foregroundHeight,
  };
}

function creditAnchor(zone: SafeZone): TextAnchor {
  return {
    x: zone.left + TEXT.padding,
    y: zone.bottom - TEXT.padding,
    align: "bottom-left",
    maxWidth: zone.width - TEXT.padding * 2,
    maxHeight: TEXT.creditLineHeight,
  };
}

export function getTextPlacement(input: {
  layout: VerticalLayout;
  source?: SourceSize;
  frame?: FrameSize;
}): TextPlacement {
  const frame = input.frame ?? { width: FRAME_WIDTH, height: FRAME_HEIGHT };
  const zone = getSafeZone(frame);
  const credit = creditAnchor(zone);
  const creditTop = anchorBounds(credit).y;
  const maxTextWidth = zone.width - TEXT.padding * 2;
  const centerX = zone.left + zone.width / 2;

  if (input.layout.layout === "stacked-split") {
    const source = input.source ?? { width: 1920, height: 1080 };
    const geometry = getStackedSplitGeometry(input.layout, source, frame);
    const captionY = geometry.seamY + TEXT.padding;
    const maxHeight = Math.min(
      TEXT.captionLineHeight * TEXT.captionMaxLines,
      Math.max(TEXT.captionLineHeight, creditTop - TEXT.padding - captionY),
    );
    return {
      caption: {
        x: centerX,
        y: captionY,
        align: "top-center",
        maxWidth: maxTextWidth,
        maxHeight,
      },
      title: undefined,
      credit,
    };
  }

  const geometry = getBlurredBackgroundGeometry(frame);
  const title: TextAnchor = {
    x: centerX,
    y: zone.top + TEXT.padding,
    align: "top-center",
    maxWidth: maxTextWidth,
    maxHeight: Math.max(TEXT.titleLineHeight, geometry.foregroundY - TEXT.padding * 2),
  };
  const captionBottom = creditTop - TEXT.padding;
  const captionTopLimit = geometry.foregroundY + geometry.foregroundHeight + TEXT.padding;
  const maxHeight = Math.min(
    TEXT.captionLineHeight * TEXT.captionMaxLines,
    Math.max(TEXT.captionLineHeight, captionBottom - captionTopLimit),
  );
  return {
    caption: {
      x: centerX,
      y: captionBottom,
      align: "bottom-center",
      maxWidth: maxTextWidth,
      maxHeight,
    },
    title,
    credit,
  };
}

export type TimedWord = {
  start: number;
  end: number;
  text: string;
};
