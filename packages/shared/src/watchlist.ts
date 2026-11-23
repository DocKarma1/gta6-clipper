import { normalizeLogin } from "./auto-settings";

export type StreamPlatform = "twitch" | "youtube" | "kick";

export type WatchlistEntry = {
  displayName: string;
  /** Login on the primary `platform`. */
  login: string;
  /** Platform the streamer is primarily known to stream on. */
  platform: StreamPlatform;
  /** 1 = highest priority. */
  priority: number;
  /** Twitch login used for matching live GTA streams, if the streamer has one we watch. */
  twitchLogin: string | undefined;
  /** twitchLogin was confirmed via Helix /users (read-only, 23 Nov 2026). */
  twitchVerified: boolean;
  /**
   * The capture worker needs Twitch for liveness, IRC chat spikes, and HLS.
   * YouTube/Kick-first entries are kept for later; only Twitch broadcasts are captured.
   */
  captureSupported: boolean;
  note?: string;
};

/**
 * Priority watchlist (owner-provided order). Twitch logins were verified
 * read-only against Twitch Helix /users. Primary platform for IShowSpeed
 * (YouTube) and N3on (Kick) comes from research, not an API check.
 */
export const DEFAULT_WATCHLIST: readonly WatchlistEntry[] = [
  {
    displayName: "IShowSpeed",
    login: "ishowspeed",
    platform: "youtube",
    priority: 1,
    twitchLogin: "ishowspeed",
    twitchVerified: true,
    captureSupported: true,
    note: "Streams mainly on YouTube; only his Twitch broadcasts are captured.",
  },
  {
    displayName: "Kai Cenat",
    login: "kaicenat",
    platform: "twitch",
    priority: 2,
    twitchLogin: "kaicenat",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "ohnePixel",
    login: "ohnepixel",
    platform: "twitch",
    priority: 3,
    twitchLogin: "ohnepixel",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "Lacy",
    login: "lacy",
    platform: "twitch",
    priority: 4,
    twitchLogin: "lacy",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "DjMaRiiO",
    login: "djmariio",
    platform: "twitch",
    priority: 5,
    twitchLogin: "djmariio",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "CaseOh",
    login: "caseoh_",
    platform: "twitch",
    priority: 6,
    twitchLogin: "caseoh_",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "xQc",
    login: "xqc",
    platform: "twitch",
    priority: 7,
    twitchLogin: "xqc",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "IlloJuan",
    login: "illojuan",
    platform: "twitch",
    priority: 8,
    twitchLogin: "illojuan",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "alanzoka",
    login: "alanzoka",
    platform: "twitch",
    priority: 9,
    twitchLogin: "alanzoka",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "Tminnzy",
    login: "tminnzy",
    platform: "twitch",
    priority: 10,
    twitchLogin: "tminnzy",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "stableronaldo",
    login: "stableronaldo",
    platform: "twitch",
    priority: 11,
    twitchLogin: "stableronaldo",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "evelone2004",
    login: "evelone2004",
    platform: "twitch",
    priority: 12,
    twitchLogin: "evelone2004",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "TheBurntPeanut",
    login: "theburntpeanut",
    platform: "twitch",
    priority: 13,
    twitchLogin: "theburntpeanut",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "Jynxzi",
    login: "jynxzi",
    platform: "twitch",
    priority: 14,
    twitchLogin: "jynxzi",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "Dinah",
    login: "dinah",
    platform: "twitch",
    priority: 15,
    twitchLogin: "dinah",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "ZLOYn",
    login: "zloyn",
    platform: "twitch",
    priority: 16,
    twitchLogin: "zloyn",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "buster",
    login: "buster",
    platform: "twitch",
    priority: 17,
    twitchLogin: "buster",
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "Fanum",
    login: "fanum",
    platform: "twitch",
    priority: 18,
    twitchLogin: "fanum",
    twitchVerified: true,
    captureSupported: true,
    note: "Low clip demand, so low priority.",
  },
  {
    displayName: "N3on",
    login: "n3on",
    platform: "kick",
    priority: 19,
    twitchLogin: undefined,
    twitchVerified: false,
    captureSupported: false,
    note: "Streams on Kick. Not captured: liveness and chat spikes are Twitch-only for now. (twitch.tv/neon is an unrelated channel and is not listed.)",
  },
];

/** Priority by Twitch login, for entries the capture worker can follow. */
export function watchlistPriorityByLogin(
  entries: readonly WatchlistEntry[] = DEFAULT_WATCHLIST,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.twitchLogin || !entry.twitchVerified || !entry.captureSupported) continue;
    const login = normalizeLogin(entry.twitchLogin);
    const existing = map.get(login);
    if (existing === undefined || entry.priority < existing) map.set(login, entry.priority);
  }
  return map;
}
