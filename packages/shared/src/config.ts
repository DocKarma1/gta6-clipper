import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { ConfigError } from "./errors";

const emptyToUndefined = (value: unknown): unknown => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const nonEmptyString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  NEXT_PUBLIC_APP_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default("http://localhost:3000"),
  ),

  NEXT_PUBLIC_SUPABASE_URL: nonEmptyString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmptyString,
  SUPABASE_SERVICE_ROLE_KEY: nonEmptyString,

  R2_ACCOUNT_ID: nonEmptyString,
  R2_ACCESS_KEY_ID: nonEmptyString,
  R2_SECRET_ACCESS_KEY: nonEmptyString,
  R2_BUCKET_NAME: nonEmptyString,
  R2_ENDPOINT: nonEmptyString,
  R2_PUBLIC_BASE_URL: nonEmptyString,

  REDIS_URL: z.preprocess(emptyToUndefined, z.string().min(1).default("redis://127.0.0.1:6379")),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  CLIP_MAX_SECONDS: z.coerce.number().int().positive().default(60),
  WHISPER_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default("small")),
  WHISPER_DEVICE: z.preprocess(emptyToUndefined, z.string().min(1).default("cpu")),
  WHISPER_PYTHON: z.preprocess(emptyToUndefined, z.string().min(1).default("python3")),
  /** Local Ollama server for all AI text (titles, descriptions, hashtags, hooks). */
  OLLAMA_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  OLLAMA_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  /** Language for generated copy: en or sv. */
  AI_LANGUAGE: z.preprocess(emptyToUndefined, z.enum(["en", "sv"]).default("en")),
  /** Legacy aliases for OLLAMA_URL / OLLAMA_MODEL. */
  LLM_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  LLM_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GROQ_API_KEY: nonEmptyString,
  GEMINI_API_KEY: nonEmptyString,

  TWITCH_CLIENT_ID: nonEmptyString,
  TWITCH_CLIENT_SECRET: nonEmptyString,
  TWITCH_USER_ACCESS_TOKEN: nonEmptyString,
  TWITCH_USER_REFRESH_TOKEN: nonEmptyString,

  YOUTUBE_API_KEY: nonEmptyString,
  YOUTUBE_CLIENT_ID: nonEmptyString,
  YOUTUBE_CLIENT_SECRET: nonEmptyString,
  YOUTUBE_REDIRECT_URI: nonEmptyString,

  TIKTOK_CLIENT_KEY: nonEmptyString,
  TIKTOK_CLIENT_SECRET: nonEmptyString,
  TIKTOK_REDIRECT_URI: nonEmptyString,

  META_APP_ID: nonEmptyString,
  META_APP_SECRET: nonEmptyString,
  META_REDIRECT_URI: nonEmptyString,

  STRIPE_SECRET_KEY: nonEmptyString,
  STRIPE_WEBHOOK_SECRET: nonEmptyString,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: nonEmptyString,
  STRIPE_PRICE_STARTER: nonEmptyString,
  STRIPE_PRICE_PRO: nonEmptyString,
  STRIPE_PRICE_STUDIO: nonEmptyString,
});

export type AppConfig = z.infer<typeof envSchema>;

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
/** ~3B instruct model: fast on CPU, ~2 GB. Alternatives: qwen2.5:7b-instruct, gemma2:2b, mistral:7b-instruct. */
export const DEFAULT_OLLAMA_MODEL = "llama3.2:3b";

export function getOllamaSettings(config: AppConfig = getConfig()): {
  url: string;
  model: string;
  timeoutMs: number;
  language: "en" | "sv";
} {
  return {
    url: (config.OLLAMA_URL ?? config.LLM_BASE_URL ?? DEFAULT_OLLAMA_URL).replace(/\/+$/u, ""),
    model: config.OLLAMA_MODEL ?? config.LLM_MODEL ?? DEFAULT_OLLAMA_MODEL,
    timeoutMs: config.OLLAMA_TIMEOUT_MS,
    language: config.AI_LANGUAGE,
  };
}

export type TwitchCredentials = {
  clientId: string;
  clientSecret: string;
};

function isWorkspaceRoot(pkg: { workspaces?: unknown }): boolean {
  return (
    Array.isArray(pkg.workspaces) &&
    pkg.workspaces.some((workspace) => workspace === "apps/web" || workspace === "packages/*")
  );
}

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i += 1) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: unknown };
        if (isWorkspaceRoot(pkg)) {
          return dir;
        }
      } catch {
        // Keep walking; never include file contents in thrown messages.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

/**
 * Loads the repo-root .env.local into process.env when values are not already set.
 * Existing process env wins (Next.js may already have loaded apps/web/.env.local).
 * This function never logs or returns file contents.
 */
export function loadRepoEnv(): string {
  const root = findRepoRoot();
  const envPath = path.join(root, ".env.local");
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath, override: false });
  }
  return root;
}

function formatEnvIssues(error: z.ZodError): string {
  const fields = [
    ...new Set(
      error.issues.map((issue) => (issue.path[0] !== undefined ? String(issue.path[0]) : "env")),
    ),
  ];
  return `Invalid environment configuration for: ${fields.join(", ")}. Set valid values in the repo-root .env.local (see .env.example). Values are not logged.`;
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  loadRepoEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError(formatEnvIssues(parsed.error));
  }
  cached = parsed.data;
  return cached;
}

export function getTwitchCredentials(): TwitchCredentials {
  const config = getConfig();
  const clientId = config.TWITCH_CLIENT_ID;
  const clientSecret = config.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const missing = [
      ...(!clientId ? ["TWITCH_CLIENT_ID"] : []),
      ...(!clientSecret ? ["TWITCH_CLIENT_SECRET"] : []),
    ];
    throw new ConfigError(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Set them in the repo-root .env.local (not committed).`,
    );
  }
  return { clientId, clientSecret };
}

export function resetConfigCache(): void {
  cached = undefined;
}
