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

export function scaleCropRect(rect: CropRect, from: SourceSize, to: SourceSize): CropRect {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  const x = even(rect.x * sx);
  const y = even(rect.y * sy);
  const width = even(rect.width * sx);
  const height = even(rect.height * sy);
  return {
    x: Math.max(0, Math.min(x, to.width - 2)),
    y: Math.max(0, Math.min(y, to.height - 2)),
    width: Math.max(2, Math.min(width, to.width - x)),
    height: Math.max(2, Math.min(height, to.height - y)),
  };
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
      const rect = scaleTo ? scaleCropRect(parsed.rect, from, scaleTo) : parsed.rect;
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
    const cached = this.cache.get(channelLogin);
    if (cached) return cached;
    const detection = await this.detectImage(imagePath, scaleTo);
    if (detection) this.cache.set(channelLogin, detection);
    return detection;
  }

  accept(detection: FacecamDetection | undefined): detection is FacecamDetection {
    return shouldUseFacecam(detection, this.minConfidence);
  }
}
