import {
  getLogger,
  getTwitchCredentials,
  TwitchApiError,
  TwitchAuthError,
  TwitchRateLimitError,
} from "@gta6-clipper/shared";
import { getAppAccessToken, invalidateAppAccessToken } from "./token";

const HELIX_BASE = "https://api.twitch.tv/helix";
const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 2_500;
const REQUEST_TIMEOUT_MS = 10_000;

const log = getLogger("twitch.helix");

export type HelixQuery = Record<string, string | number | undefined>;

function buildUrl(path: string, query?: HelixQuery): string {
  const url = new URL(path.startsWith("http") ? path : `${HELIX_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function parseResetMs(response: Response, now: number): number | undefined {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return now + seconds * 1000;
    }
  }
  const reset = response.headers.get("Ratelimit-Reset");
  if (reset) {
    const unix = Number(reset);
    if (Number.isFinite(unix) && unix > 0) {
      return unix * 1000;
    }
  }
  return undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new TwitchApiError("Twitch returned a non-JSON response body.", {
      statusCode: 502,
      cause: error,
    });
  }
}

export async function helixGet(path: string, query?: HelixQuery): Promise<unknown> {
  const { clientId } = getTwitchCredentials();
  const url = buildUrl(path, query);
  let usedFreshToken = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const accessToken = await getAppAccessToken();
    const now = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "Client-Id": clientId,
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        log.warn({ attempt, path }, "Twitch Helix request failed to connect; retrying");
        await sleep(200 * attempt);
        continue;
      }
      throw new TwitchApiError("Could not reach the Twitch Helix API.", {
        statusCode: 502,
        retryable: true,
        cause: error,
      });
    }

    if (response.status === 401 && !usedFreshToken) {
      log.warn({ path, status: 401 }, "Twitch returned 401; refreshing the app access token");
      invalidateAppAccessToken();
      usedFreshToken = true;
      continue;
    }

    if (response.status === 429) {
      const retryAtMs = parseResetMs(response, now);
      const waitMs = Math.max(0, (retryAtMs ?? now + 500) - Date.now());
      if (attempt < MAX_RETRIES && waitMs <= MAX_RETRY_WAIT_MS) {
        log.warn({ path, waitMs, attempt }, "Twitch rate-limited the request; retrying");
        await sleep(waitMs);
        continue;
      }
      throw new TwitchRateLimitError("Twitch rate-limited the Helix request.", retryAtMs);
    }

    if (response.status >= 500 && attempt < MAX_RETRIES) {
      log.warn({ path, status: response.status, attempt }, "Twitch Helix server error; retrying");
      await sleep(200 * attempt);
      continue;
    }

    if (!response.ok) {
      log.warn({ path, status: response.status }, "Twitch Helix request failed");
      if (response.status === 401) {
        throw new TwitchAuthError("Twitch rejected the Helix request after a token refresh.", {
          statusCode: 401,
        });
      }
      throw new TwitchApiError("The Twitch Helix request failed.", {
        statusCode: response.status,
        retryable: response.status >= 500,
      });
    }

    return readJson(response);
  }

  throw new TwitchApiError("The Twitch Helix request failed after retries.", {
    retryable: true,
  });
}
