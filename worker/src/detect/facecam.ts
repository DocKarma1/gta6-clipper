import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { findRepoRoot, getLogger, type CropRect, type SourceSize } from "@gta6-clipper/shared";

const execFileAsync = promisify(execFile);
const log = getLogger("worker.facecam");

export const FACECAM_MIN_CONFIDENCE = 0.55;
export const FACECAM_CACHE_TTL_MS = 30 * 60 * 1000;

export type FacecamDetection = {
  rect: CropRect;
  confidence: number;
  method: string;
  sourceWidth: number;
  sourceHeight: number;
};

export type CachedFacecam = FacecamDetection & {
  channelLogin: string;
  detectedAt: number;
};

type PythonResult = {
  ok: boolean;
  confidence?: number;
  rect?: CropRect | null;
  method?: string;
  width?: number;
  height?: number;
  error?: string;
};

export function evenCropRect(rect: CropRect, bounds?: SourceSize): CropRect {
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  const widthBound = bounds?.width ?? Number.MAX_SAFE_INTEGER;
  const heightBound = bounds?.height ?? Number.MAX_SAFE_INTEGER;
  const x = even(rect.x);
  const y = even(rect.y);
  const width = even(rect.width);
  const height = even(rect.height);
  return {
    x: Math.max(0, Math.min(x, widthBound - 2)),
    y: Math.max(0, Math.min(y, heightBound - 2)),
    width: Math.max(2, Math.min(width, widthBound - x)),
    height: Math.max(2, Math.min(height, heightBound - y)),
  };
}

export function scaleCropRect(rect: CropRect, from: SourceSize, to: SourceSize): CropRect {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return evenCropRect(
    {
      x: rect.x * sx,
      y: rect.y * sy,
      width: rect.width * sx,
      height: rect.height * sy,
    },
    to,
  );
}

/**
 * Reject detections that cannot be a webcam overlay: too small, too large,
 * or outside the frame.
 */
export function isPlausibleFacecam(rect: CropRect, size: SourceSize): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.x < 0 || rect.y < 0) return false;
  if (rect.x + rect.width > size.width + 1 || rect.y + rect.height > size.height + 1) return false;
  const area = (rect.width * rect.height) / (size.width * size.height);
  const aspect = rect.width / rect.height;
  return area >= 0.015 && area <= 0.4 && aspect >= 0.5 && aspect <= 2.6;
}

/** Intersection over union of two rects. */
export function rectIoU(a: CropRect, b: CropRect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Pick the best detection across several frames. A rect seen in at least two
 * frames (IoU >= 0.5) gets a small confidence bonus; a lone detection that
 * disagrees with the others is penalised (the camera may be hidden or moving).
 */
export function pickConsensusFacecam(
  detections: readonly (FacecamDetection | undefined)[],
): FacecamDetection | undefined {
  const valid = detections.filter(
    (item): item is FacecamDetection =>
      Boolean(item) &&
      isPlausibleFacecam(item!.rect, { width: item!.sourceWidth, height: item!.sourceHeight }),
  );
  if (valid.length === 0) return undefined;
  const scored = valid.map((item) => {
    const agree = valid.filter(
      (other) => other !== item && rectIoU(item.rect, other.rect) >= 0.5,
    ).length;
    const adjust = valid.length === 1 ? 0 : agree > 0 ? 0.05 : -0.1;
    return { ...item, confidence: Math.max(0, Math.min(1, item.confidence + adjust)) };
  });
  return scored.sort((a, b) => b.confidence - a.confidence)[0];
}

export function shouldUseFacecam(
  detection: FacecamDetection | undefined,
  minConfidence = FACECAM_MIN_CONFIDENCE,
): detection is FacecamDetection {
  return Boolean(detection && detection.confidence >= minConfidence);
}

export function defaultFacecamPython(): string {
  const root = findRepoRoot();
  const venv = path.join(root, ".venv", "bin", "python");
  if (existsSync(venv)) return venv;
  return "python3";
}

export function defaultFacecamScript(): string {
  return path.join(findRepoRoot(), "worker", "scripts", "detect_facecam.py");
}

export class FacecamCache {
  private readonly memory = new Map<string, CachedFacecam>();

  constructor(
    private readonly filePath: string | undefined,
    private readonly ttlMs = FACECAM_CACHE_TTL_MS,
  ) {
    this.load();
  }

  get(channelLogin: string): CachedFacecam | undefined {
    const entry = this.memory.get(channelLogin);
    if (!entry) return undefined;
    if (Date.now() - entry.detectedAt > this.ttlMs) {
      this.memory.delete(channelLogin);
      return undefined;
    }
    return entry;
  }

  set(channelLogin: string, detection: FacecamDetection): CachedFacecam {
    const entry: CachedFacecam = { ...detection, channelLogin, detectedAt: Date.now() };
    this.memory.set(channelLogin, entry);
    this.save();
    return entry;
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as CachedFacecam[];
      for (const entry of parsed) {
        this.memory.set(entry.channelLogin, entry);
      }
    } catch {
      // Ignore a corrupt cache and start empty.
    }
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify([...this.memory.values()], null, 2));
  }
}

export class FacecamDetector {
  private readonly pythonPath: string;
  private readonly scriptPath: string;
  private readonly minConfidence: number;
  private readonly cache: FacecamCache;

  constructor(options?: {
    pythonPath?: string;
    scriptPath?: string;
    minConfidence?: number;
    cache?: FacecamCache;
    cachePath?: string;
  }) {
    this.pythonPath = options?.pythonPath ?? defaultFacecamPython();
    this.scriptPath = options?.scriptPath ?? defaultFacecamScript();
    this.minConfidence = options?.minConfidence ?? FACECAM_MIN_CONFIDENCE;
    this.cache = options?.cache ?? new FacecamCache(options?.cachePath);
  }

  getCached(channelLogin: string): CachedFacecam | undefined {
    return this.cache.get(channelLogin);
  }

  async detectImage(
    imagePath: string,
    scaleTo?: SourceSize,
  ): Promise<FacecamDetection | undefined> {
    if (!existsSync(this.scriptPath) || !existsSync(imagePath)) return undefined;
    try {
      const { stdout } = await execFileAsync(this.pythonPath, [this.scriptPath, imagePath], {
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      });
      const parsed = JSON.parse(stdout) as PythonResult;
      if (!parsed.ok || !parsed.rect || parsed.confidence === undefined) return undefined;
      const from = { width: parsed.width ?? 0, height: parsed.height ?? 0 };
      if (from.width <= 0 || from.height <= 0) return undefined;
      const rect = evenCropRect(
        scaleTo ? scaleCropRect(parsed.rect, from, scaleTo) : parsed.rect,
        scaleTo ?? from,
      );
      return {
        rect,
        confidence: parsed.confidence,
        method: parsed.method ?? "unknown",
        sourceWidth: scaleTo?.width ?? from.width,
        sourceHeight: scaleTo?.height ?? from.height,
      };
    } catch (error) {
      log.warn(
        { err: error instanceof Error ? error.message : "unknown" },
        "Facecam detection failed",
      );
      return undefined;
    }
  }

  async detectForChannel(
    channelLogin: string,
    imagePath: string,
    scaleTo?: SourceSize,
  ): Promise<FacecamDetection | undefined> {
    return this.detectBestForChannel(channelLogin, [imagePath], scaleTo);
  }

  /**
   * Detect on several frames and keep the consensus. Only confident results
   * are cached, and a cached rect is ignored when the source size changed.
   */
  async detectBestForChannel(
    channelLogin: string,
    imagePaths: readonly string[],
    scaleTo?: SourceSize,
  ): Promise<FacecamDetection | undefined> {
    const cached = this.cache.get(channelLogin);
    if (
      cached &&
      (!scaleTo || (cached.sourceWidth === scaleTo.width && cached.sourceHeight === scaleTo.height))
    ) {
      return cached;
    }
    const detections: (FacecamDetection | undefined)[] = [];
    for (const imagePath of imagePaths) {
      detections.push(await this.detectImage(imagePath, scaleTo));
    }
    const best = pickConsensusFacecam(detections);
    if (best && shouldUseFacecam(best)) this.cache.set(channelLogin, best);
    return best;
  }

  accept(detection: FacecamDetection | undefined): detection is FacecamDetection {
    return shouldUseFacecam(detection, this.minConfidence);
  }
}
