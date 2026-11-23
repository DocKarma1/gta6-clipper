import { z } from "zod";
import { ConfigError } from "./errors";
import { getPlan, isPlanId, type PlanId } from "./plans";
import { loadRepoEnv } from "./config";
import path from "node:path";

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
  AUTO_REQUIRE_PERMISSION: boolFromEnv,
  AUTO_PERMITTED_CHANNELS: csvFromEnv,
  AUTO_WRITE_LOCAL_ONLY: boolFromEnv,
  AUTO_SEGMENT_SECONDS: z.coerce.number().int().positive().default(10),
  AUTO_BUFFER_SECONDS: z.coerce.number().int().positive().default(120),
  AUTO_PRE_ROLL_SECONDS: z.coerce.number().int().positive().default(20),
  AUTO_POST_ROLL_SECONDS: z.coerce.number().int().positive().default(10),
  AUTO_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  AUTO_RUN_SECONDS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  DATA_DIR: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  STREAMLINK_PATH: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AUTO_PLAN: z.preprocess(emptyToUndefined, z.enum(["starter", "pro", "studio"]).optional()),
  AUTO_WORKSPACE_ID: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
});

export type AutoSettings = {
  topK: number;
  pollIntervalMs: number;
  languages: string[];
  allowList: string[];
  denyList: string[];
  requirePermission: boolean;
  permittedChannels: string[];
  writeLocalOnly: boolean;
  segmentSeconds: number;
  bufferSeconds: number;
  preRollSeconds: number;
  postRollSeconds: number;
  cooldownSeconds: number;
  runSeconds: number | undefined;
  dataDir: string;
  streamlinkPath: string;
  planId: PlanId;
  /** Supabase workspace whose receipts and settings the worker follows (needs the service role key). */
  workspaceId: string | undefined;
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
  const defaultStreamlink = path.join(root, ".venv", "bin", "streamlink");
  cached = {
    topK: env.AUTO_TOP_K,
    pollIntervalMs: Math.round(env.AUTO_POLL_MINUTES * 60_000),
    languages: env.AUTO_LANGUAGES ?? [],
    allowList: env.AUTO_ALLOW_LIST ?? [],
    denyList: env.AUTO_DENY_LIST ?? [],
    requirePermission: env.AUTO_REQUIRE_PERMISSION ?? true,
    permittedChannels: env.AUTO_PERMITTED_CHANNELS ?? [],
    writeLocalOnly: env.AUTO_WRITE_LOCAL_ONLY ?? true,
    segmentSeconds: env.AUTO_SEGMENT_SECONDS,
    bufferSeconds: env.AUTO_BUFFER_SECONDS,
    preRollSeconds: env.AUTO_PRE_ROLL_SECONDS,
    postRollSeconds: env.AUTO_POST_ROLL_SECONDS,
    cooldownSeconds: env.AUTO_COOLDOWN_SECONDS,
    runSeconds: env.AUTO_RUN_SECONDS,
    dataDir,
    streamlinkPath: env.STREAMLINK_PATH ?? defaultStreamlink,
    planId: env.AUTO_PLAN && isPlanId(env.AUTO_PLAN) ? env.AUTO_PLAN : "starter",
    workspaceId: env.AUTO_WORKSPACE_ID,
  };
  cached.topK = Math.min(cached.topK, getPlan(cached.planId).streamsAtOnce);
  return cached;
}

export function resetAutoSettingsCache(): void {
  cached = undefined;
}

export function normalizeLogin(login: string): string {
  return login.trim().replace(/^@+/u, "").toLowerCase();
}
