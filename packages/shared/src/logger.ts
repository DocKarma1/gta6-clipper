import pino, { type Logger } from "pino";
import { getConfig } from "./config";

const REDACT_PATHS = [
  "client_secret",
  "clientSecret",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "Authorization",
  "authorization",
  "TWITCH_CLIENT_SECRET",
  "TWITCH_CLIENT_ID",
  "TWITCH_USER_ACCESS_TOKEN",
  "TWITCH_USER_REFRESH_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "R2_ACCESS_KEY_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_API_KEY",
  "TIKTOK_CLIENT_SECRET",
  "META_APP_SECRET",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
];

let rootLogger: Logger | undefined;

export function getLogger(name?: string): Logger {
  if (!rootLogger) {
    const { LOG_LEVEL, NODE_ENV } = getConfig();
    rootLogger = pino({
      level: LOG_LEVEL ?? (NODE_ENV === "production" ? "info" : "debug"),
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      base: { service: "gta6-clipper" },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return name ? rootLogger.child({ module: name }) : rootLogger;
}
