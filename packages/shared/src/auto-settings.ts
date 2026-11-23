import { z } from "zod";
import { ConfigError } from "./errors";
import { getPlan, isPlanId, type PlanId } from "./plans";
import { loadRepoEnv } from "./config";
import path from "node:path";
import { venvOrPath } from "./venv";

const emptyToUndefined = (value: unknown): unknown => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const boolFromEnv = z.preprocess((value) => {
  const v = emptyToUndefined(value);
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.toLowerCase());
  return v;
}, z.boolean().optional());

const csvFromEnv = z.preprocess((value) => {
  const v = emptyToUndefined(value);
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    return v
      .split(",")
      .map((item) => item.trim().replace(/^@+/u, "").toLowerCase())
      .filter(Boolean);
  }
  return v;
}, z.array(z.string()).optional());

const autoSchema = z.object({
  AUTO_TOP_K: z.coerce.number().int().positive().default(3),
  AUTO_POLL_MINUTES: z.coerce.number().positive().default(2),
  AUTO_LANGUAGES: csvFromEnv,
  AUTO_ALLOW_LIST: csvFromEnv,
  AUTO_DENY_LIST: csvFromEnv,
  AUTO_WRITE_LOCAL_ONLY: boolFromEnv,
  AUTO_MAX_CONCURRENT: z.coerce.number().int().positive().default(3),
  AUTO_INCLUDE_GTA_V: boolFromEnv,
  AUTO_WATCHLIST: boolFromEnv,
  AUTO_STREAM_QUALITY: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("1080p60,1080p,936p60,720p60,720p,best"),
  ),
  AUTO_SEGMENT_SECONDS: z.coerce.number().int().min(2).max(30).default(6),
  AUTO_BUFFER_SECONDS: z.coerce.number().int().min(60).default(150),
  AUTO_PRE_ROLL_SECONDS: z.coerce.number().min(2).max(40).default(10),
  AUTO_POST_ROLL_SECONDS: z.coerce.number().min(1).max(30).default(5),
  AUTO_MIN_CLIP_SECONDS: z.coerce.number().min(5).max(60).default(15),
  AUTO_MAX_CLIP_SECONDS: z.coerce.number().min(10).max(180).default(45),
  AUTO_CHAT_DELAY_SECONDS: z.coerce.number().min(0).max(20).default(3),
  AUTO_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(45),
  AUTO_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  AUTO_KEEP_RAW: boolFromEnv,
  AUTO_SPEECH_QUESTION_SECONDS: z.coerce.number().int().min(0).max(600).default(30),
  AUTO_SPEECH_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default("tiny")),
  RENDER_PRESET: z.preprocess(
    emptyToUndefined,
    z
      .enum(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower"])
      .default("medium"),
  ),
  RENDER_CRF: z.coerce.number().int().min(14).max(28).default(19),
  RENDER_TARGET_LUFS: z.coerce.number().min(-24).max(-9).default(-14),
  AUTO_RUN_SECONDS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  DATA_DIR: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  STREAMLINK_PATH: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AUTO_PLAN: z.preprocess(emptyToUndefined, z.enum(["starter", "pro", "studio"]).optional()),
});

export type AutoSettings = {
  topK: number;
  pollIntervalMs: number;
  languages: string[];
  allowList: string[];
  denyList: string[];
  writeLocalOnly: boolean;
  /** Ceiling for concurrent streams on a self-hosted machine (default 3). */
  maxConcurrent: number;
  includeGtaV: boolean;
  useWatchlist: boolean;
  streamQuality: string;
  segmentSeconds: number;
  bufferSeconds: number;
  /** Base lead-in before the chat-derived event time. */
  preRollSeconds: number;
  /** Base lead-out after the chat peak. */
  postRollSeconds: number;
  minClipSeconds: number;
  maxClipSeconds: number;
  /** How long chat takes to react to what is on screen. */
  chatDelaySeconds: number;
  cooldownSeconds: number;
  renderConcurrency: number;
  /** Keep the stream-copied source MP4 next to each clip (debugging). */
  keepRaw: boolean;
  /** Seconds between speech-question transcriptions per channel; 0 disables. */
  speechQuestionSeconds: number;
  speechModel: string;
  renderPreset: string;
  renderCrf: number;
  targetLufs: number;
  runSeconds: number | undefined;
  dataDir: string;
  streamlinkPath: string;
  planId: PlanId;
};

function formatIssues(error: z.ZodError): string {
  const fields = [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "env")))];
  return `Invalid auto-worker environment configuration for: ${fields.join(", ")}. Values are not logged.`;
}

let cached: AutoSettings | undefined;

export function getAutoSettings(): AutoSettings {
  if (cached) return cached;
  const root = loadRepoEnv();
  const parsed = autoSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError(formatIssues(parsed.error));
  }
  const env = parsed.data;
  const dataDir = path.resolve(root, env.DATA_DIR ?? path.join(root, "data"));
  const defaultStreamlink = venvOrPath(root, "streamlink");
  cached = {
    topK: env.AUTO_TOP_K,
    pollIntervalMs: Math.round(env.AUTO_POLL_MINUTES * 60_000),
    languages: env.AUTO_LANGUAGES ?? [],
    allowList: env.AUTO_ALLOW_LIST ?? [],
    denyList: env.AUTO_DENY_LIST ?? [],
    writeLocalOnly: env.AUTO_WRITE_LOCAL_ONLY ?? true,
    maxConcurrent: env.AUTO_MAX_CONCURRENT,
    includeGtaV: env.AUTO_INCLUDE_GTA_V ?? false,
    useWatchlist: env.AUTO_WATCHLIST ?? true,
    streamQuality: env.AUTO_STREAM_QUALITY,
    segmentSeconds: env.AUTO_SEGMENT_SECONDS,
    bufferSeconds: env.AUTO_BUFFER_SECONDS,
    preRollSeconds: env.AUTO_PRE_ROLL_SECONDS,
    postRollSeconds: env.AUTO_POST_ROLL_SECONDS,
    minClipSeconds: env.AUTO_MIN_CLIP_SECONDS,
    maxClipSeconds: Math.max(env.AUTO_MAX_CLIP_SECONDS, env.AUTO_MIN_CLIP_SECONDS),
    chatDelaySeconds: env.AUTO_CHAT_DELAY_SECONDS,
    cooldownSeconds: env.AUTO_COOLDOWN_SECONDS,
    renderConcurrency: env.AUTO_RENDER_CONCURRENCY,
    keepRaw: env.AUTO_KEEP_RAW ?? false,
    speechQuestionSeconds: env.AUTO_SPEECH_QUESTION_SECONDS,
    speechModel: env.AUTO_SPEECH_MODEL,
    renderPreset: env.RENDER_PRESET,
    renderCrf: env.RENDER_CRF,
    targetLufs: env.RENDER_TARGET_LUFS,
    runSeconds: env.AUTO_RUN_SECONDS,
    dataDir,
    streamlinkPath: env.STREAMLINK_PATH ?? defaultStreamlink,
    planId: env.AUTO_PLAN && isPlanId(env.AUTO_PLAN) ? env.AUTO_PLAN : "starter",
  };
  cached.topK = effectiveStreamCap(cached);
  return cached;
}

export function resetAutoSettingsCache(): void {
  cached = undefined;
}

export function normalizeLogin(login: string): string {
  return login.trim().replace(/^@+/u, "").toLowerCase();
}

/** Concurrent stream cap: min(AUTO_TOP_K, plan limit, AUTO_MAX_CONCURRENT). */
export function effectiveStreamCap(
  settings: Pick<AutoSettings, "topK" | "planId" | "maxConcurrent">,
): number {
  return Math.max(
    0,
    Math.min(settings.topK, getPlan(settings.planId).streamsAtOnce, settings.maxConcurrent),
  );
}
