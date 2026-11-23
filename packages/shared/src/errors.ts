export type ErrorCode =
  | "CONFIG_INVALID"
  | "TWITCH_AUTH_FAILED"
  | "TWITCH_RATE_LIMITED"
  | "TWITCH_API_ERROR"
  | "TWITCH_CATEGORY_NOT_FOUND"
  | "TWITCH_RESPONSE_INVALID"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { statusCode?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.statusCode = options?.statusCode ?? 500;
    this.retryable = options?.retryable ?? false;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, cause?: unknown) {
    super("CONFIG_INVALID", message, { statusCode: 500, retryable: false, cause });
    this.name = "ConfigError";
  }
}

export class TwitchAuthError extends AppError {
  constructor(message: string, options?: { statusCode?: number; cause?: unknown }) {
    super("TWITCH_AUTH_FAILED", message, {
      statusCode: options?.statusCode ?? 401,
      retryable: true,
      cause: options?.cause,
    });
    this.name = "TwitchAuthError";
  }
}

export class TwitchRateLimitError extends AppError {
  readonly retryAtMs: number | undefined;

  constructor(message: string, retryAtMs?: number, cause?: unknown) {
    super("TWITCH_RATE_LIMITED", message, { statusCode: 429, retryable: true, cause });
    this.name = "TwitchRateLimitError";
    this.retryAtMs = retryAtMs;
  }
}

export class TwitchApiError extends AppError {
  constructor(
    message: string,
    options?: { statusCode?: number; retryable?: boolean; code?: ErrorCode; cause?: unknown },
  ) {
    super(options?.code ?? "TWITCH_API_ERROR", message, {
      statusCode: options?.statusCode ?? 502,
      retryable: options?.retryable ?? false,
      cause: options?.cause,
    });
    this.name = "TwitchApiError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Safe, user-facing copy. Never includes env values, tokens, or response bodies
 * that might contain credentials.
 */
export function toUserMessage(error: unknown): string {
  if (isAppError(error)) {
    switch (error.code) {
      case "CONFIG_INVALID":
        return "The server is missing a required Twitch configuration value. Check the repo-root .env.local file.";
      case "TWITCH_AUTH_FAILED":
        return "Could not authenticate with Twitch. The client credentials may be invalid or expired.";
      case "TWITCH_RATE_LIMITED":
        return "Twitch is rate-limiting requests right now. Please try again in a moment.";
      case "TWITCH_CATEGORY_NOT_FOUND":
        return "The GTA 6 category was not found on Twitch, so there is nothing to list yet.";
      case "TWITCH_RESPONSE_INVALID":
        return "Twitch returned data in an unexpected format. Please try again shortly.";
      case "TWITCH_API_ERROR":
        return "Twitch could not be reached, or the request failed. Please try again shortly.";
      default:
        return "Something went wrong while loading live streams. Please try again.";
    }
  }
  return "Something went wrong while loading live streams. Please try again.";
}
