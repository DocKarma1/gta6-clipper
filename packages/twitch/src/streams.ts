import { getLogger, type LiveRadarResult, type LiveStream } from "@gta6-clipper/shared";
import { helixGet } from "./client";
import { resolveGta6Game } from "./games";
import { parseHelix } from "./parse";
import { helixStreamsResponseSchema, type HelixStream } from "./schemas";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const LIST_CACHE_MS = 15_000;
const log = getLogger("twitch.streams");

let listCache: { expiresAt: number; value: LiveRadarResult } | undefined;

export function thumbnailUrl(template: string, width = 640, height = 360): string {
  return template.replace("{width}", String(width)).replace("{height}", String(height));
}

export function toLiveStream(stream: HelixStream): LiveStream {
  return {
    id: stream.id,
    streamerLogin: stream.user_login,
    streamerName: stream.user_name,
    title: stream.title,
    viewerCount: stream.viewer_count,
    language: stream.language,
    thumbnailUrl: thumbnailUrl(stream.thumbnail_url),
    url: `https://www.twitch.tv/${stream.user_login}`,
    startedAt: stream.started_at,
    gameName: stream.game_name,
  };
}

export async function listStreamsByGameId(gameId: string): Promise<HelixStream[]> {
  const collected: HelixStream[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await helixGet("/streams", {
      game_id: gameId,
      first: PAGE_SIZE,
      after: cursor,
    });
    const parsed = parseHelix(helixStreamsResponseSchema, payload, "streams");
    for (const stream of parsed.data) {
      if (seen.has(stream.id)) continue;
      seen.add(stream.id);
      collected.push(stream);
    }
    const nextCursor = parsed.pagination?.cursor;
    if (!nextCursor || parsed.data.length === 0) {
      break;
    }
    if (page === MAX_PAGES) {
      log.warn(
        { gameId, pages: page, collected: collected.length },
        "Stopped stream pagination at the safety cap",
      );
    }
    cursor = nextCursor;
  }

  return collected;
}

export async function getLiveGta6Streams(options?: {
  skipCache?: boolean;
}): Promise<LiveRadarResult> {
  const now = Date.now();
  if (!options?.skipCache && listCache && now < listCache.expiresAt) {
    return listCache.value;
  }

  const game = await resolveGta6Game();
  const helixStreams = await listStreamsByGameId(game.id);
  const streams = helixStreams.map(toLiveStream).sort((a, b) => b.viewerCount - a.viewerCount);

  const result: LiveRadarResult = {
    game: { id: game.id, name: game.name },
    streams,
    fetchedAt: new Date().toISOString(),
  };

  listCache = { expiresAt: Date.now() + LIST_CACHE_MS, value: result };
  log.info(
    { gameId: game.id, gameName: game.name, count: streams.length },
    "Loaded live GTA 6 streams",
  );
  return result;
}

export function clearStreamListCache(): void {
  listCache = undefined;
}

export const GTA_V_GAME_NAME = "Grand Theft Auto V";
let gtaVGameId: string | undefined;

async function resolveGtaVGameId(): Promise<string | undefined> {
  if (gtaVGameId) return gtaVGameId;
  const payload = (await helixGet("/games", { name: GTA_V_GAME_NAME })) as {
    data?: Array<{ id: string; name: string }>;
  };
  gtaVGameId = payload.data?.find((game) => game.name === GTA_V_GAME_NAME)?.id;
  return gtaVGameId;
}

/** Live streams for up to 100 logins in one request (any category). */
export async function getLiveStreamsByLogins(logins: readonly string[]): Promise<LiveStream[]> {
  const unique = [...new Set(logins.map((login) => login.toLowerCase()))].slice(0, 100);
  if (unique.length === 0) return [];
  const payload = await helixGet("/streams", { user_login: unique, first: 100 });
  const parsed = parseHelix(helixStreamsResponseSchema, payload, "streams");
  return parsed.data.map(toLiveStream);
}

export type AutoCandidateResult = {
  /** All GTA VI streams (the directory). */
  directory: LiveStream[];
  /** Watchlisted streamers currently live in an allowed GTA category. */
  watchlistLive: LiveStream[];
};

/**
 * Candidates for auto-selection: the GTA VI directory plus watchlisted
 * streamers live in GTA VI (or GTA V when includeGtaV is set).
 */
export async function getAutoCandidates(options: {
  watchlistLogins: readonly string[];
  includeGtaV: boolean;
}): Promise<AutoCandidateResult> {
  const radar = await getLiveGta6Streams({ skipCache: true });
  const allowedGames = new Set([radar.game.id]);
  if (options.includeGtaV) {
    const id = await resolveGtaVGameId().catch(() => undefined);
    if (id) allowedGames.add(id);
  }
  let watchlistLive: LiveStream[] = [];
  if (options.watchlistLogins.length > 0) {
    try {
      const payload = await helixGet("/streams", {
        user_login: [...new Set(options.watchlistLogins)].slice(0, 100),
        first: 100,
      });
      const parsed = parseHelix(helixStreamsResponseSchema, payload, "streams");
      watchlistLive = parsed.data
        .filter((stream) => allowedGames.has(stream.game_id))
        .map(toLiveStream);
    } catch (error) {
      log.warn(
        { err: error instanceof Error ? error.message : "unknown" },
        "Could not check watchlisted streamers; using the directory only",
      );
    }
  }
  return { directory: radar.streams, watchlistLive };
}
