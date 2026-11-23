import { normalizeLogin } from "./auto-settings";

export type StreamPlatform = "twitch" | "youtube" | "kick";

export type WatchlistEntry = {
  displayName: string;
  /** Login on `platform`. */
  login: string;
  /** Platform the streamer is primarily known to stream on. */
  platform: StreamPlatform;
  /** 1 = highest priority. */
  priority: number;
  /** A Twitch account with this login was confirmed via Helix /users (23 Nov 2026). */
  twitchVerified: boolean;
  /**
   * The capture worker needs Twitch for liveness, IRC chat spikes, and HLS.
   * Entries whose primary platform is YouTube or Kick are still matched when
   * they stream on Twitch, but their YouTube/Kick streams are not captured yet.
   */
  captureSupported: boolean;
  note?: string;
};

/**
 * Priority watchlist. Logins were verified read-only against Twitch Helix
 * /users. Primary platform for iShowSpeed (YouTube) and Neon (Kick) is from
 * public knowledge, not an API check.
 */
export const DEFAULT_WATCHLIST: readonly WatchlistEntry[] = [
  {
    displayName: "Kai Cenat",
    login: "kaicenat",
    platform: "twitch",
    priority: 1,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "IShowSpeed",
    login: "ishowspeed",
    platform: "youtube",
    priority: 1,
    twitchVerified: true,
    captureSupported: false,
    note: "Streams mainly on YouTube; only Twitch broadcasts are captured.",
  },
  {
    displayName: "Fanum",
    login: "fanum",
    platform: "twitch",
    priority: 2,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "Neon",
    login: "neon",
    platform: "kick",
    priority: 2,
    twitchVerified: true,
    captureSupported: false,
    note: "Streams mainly on Kick; only Twitch broadcasts are captured.",
  },
  {
    displayName: "xQc",
    login: "xqc",
    platform: "twitch",
    priority: 3,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "summit1g",
    login: "summit1g",
    platform: "twitch",
    priority: 3,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "ohnePixel",
    login: "ohnepixel",
    platform: "twitch",
    priority: 3,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "buddha",
    login: "buddha",
    platform: "twitch",
    priority: 4,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "Ramee",
    login: "ramee",
    platform: "twitch",
    priority: 4,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "Lord_Kebun",
    login: "lord_kebun",
    platform: "twitch",
    priority: 4,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "koil",
    login: "koil",
    platform: "twitch",
    priority: 4,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "PENTA",
    login: "penta",
    platform: "twitch",
    priority: 4,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "IlloJuan",
    login: "illojuan",
    platform: "twitch",
    priority: 5,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "AuronPlay",
    login: "auronplay",
    platform: "twitch",
    priority: 5,
    twitchVerified: true,
    captureSupported: true,
  },
  {
    displayName: "alanzoka",
    login: "alanzoka",
    platform: "twitch",
    priority: 5,
    twitchVerified: true,
    captureSupported: true,
  },
];

/**
 * Priority by Twitch login. Every entry has a verified Twitch account, so a
 * YouTube/Kick-first streamer is still prioritised when they go live on Twitch.
 */
export function watchlistPriorityByLogin(
  entries: readonly WatchlistEntry[] = DEFAULT_WATCHLIST,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.twitchVerified) continue;
    const login = normalizeLogin(entry.login);
    const existing = map.get(login);
    if (existing === undefined || entry.priority < existing) map.set(login, entry.priority);
  }
  return map;
}
