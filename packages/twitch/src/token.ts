import { getLogger, getTwitchCredentials, TwitchAuthError } from "@gta6-clipper/shared";
import { parseHelix } from "./parse";
import { helixTokenSchema, type HelixToken } from "./schemas";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const EXPIRY_SKEW_MS = 60_000;

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cache: CachedToken | undefined;
const log = getLogger("twitch.token");

async function requestAppAccessToken(): Promise<HelixToken> {
  const { clientId, clientSecret } = getTwitchCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new TwitchAuthError("Could not reach Twitch to request an app access token.", {
      statusCode: 502,
      cause: error,
    });
  }

  if (!response.ok) {
    log.warn({ status: response.status }, "Twitch token endpoint rejected the request");
    throw new TwitchAuthError("Twitch rejected the app access token request.", {
      statusCode: response.status,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new TwitchAuthError("Twitch token endpoint returned a non-JSON body.", {
      statusCode: 502,
      cause: error,
    });
  }

  return parseHelix(helixTokenSchema, payload, "token");
}

export async function getAppAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && now < cache.expiresAt - EXPIRY_SKEW_MS) {
    return cache.accessToken;
  }

  const token = await requestAppAccessToken();
  cache = {
    accessToken: token.access_token,
    expiresAt: now + token.expires_in * 1000,
  };
  log.info({ expiresInSec: token.expires_in }, "Cached a new Twitch app access token");
  return cache.accessToken;
}

export function invalidateAppAccessToken(): void {
  cache = undefined;
}
