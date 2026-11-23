import { normalizeLogin, type AutoSettings, type LiveStream } from "@gta6-clipper/shared";

export type SelectionInput = {
  /** GTA VI directory, any order. */
  directory: readonly LiveStream[];
  /** Watchlisted streamers live in an allowed GTA category (may overlap the directory). */
  watchlistLive?: readonly LiveStream[];
  /** Twitch login -> priority (1 = highest). */
  priorities?: ReadonlyMap<string, number>;
};

export type SelectionSettings = Pick<AutoSettings, "topK" | "languages" | "allowList" | "denyList">;

export type SelectedStream = LiveStream & {
  reason: "watchlist" | "top-viewers";
  priority?: number | undefined;
};

/**
 * Pick streams to watch:
 * 1. Watchlisted streamers that are live, by priority then viewers.
 * 2. Remaining slots from the directory by viewers.
 * Deny list and language filters apply to both; a non-empty allow list
 * restricts the top-viewer fill only (watchlisted names are already curated).
 * `topK` is the final cap; callers pass min(plan limit, AUTO_MAX_CONCURRENT).
 */
export function selectStreams(
  input: SelectionInput,
  settings: SelectionSettings,
): SelectedStream[] {
  const deny = new Set(settings.denyList.map(normalizeLogin));
  const allow = new Set(settings.allowList.map(normalizeLogin));
  const languages = new Set(settings.languages.map((code) => code.toLowerCase()));
  const priorities = input.priorities ?? new Map<string, number>();
  const cap = Math.max(0, settings.topK);

  const passesFilters = (stream: LiveStream): boolean => {
    const login = normalizeLogin(stream.streamerLogin);
    if (deny.has(login)) return false;
    if (languages.size > 0 && !languages.has(stream.language.toLowerCase())) return false;
    return true;
  };

  const byLogin = new Map<string, LiveStream>();
  for (const stream of [...input.directory, ...(input.watchlistLive ?? [])]) {
    const login = normalizeLogin(stream.streamerLogin);
    const existing = byLogin.get(login);
    if (!existing || stream.viewerCount > existing.viewerCount) byLogin.set(login, stream);
  }

  const watchlisted = [...byLogin.entries()]
    .filter(([login, stream]) => priorities.has(login) && passesFilters(stream))
    .sort(
      ([loginA, a], [loginB, b]) =>
        (priorities.get(loginA) ?? 99) - (priorities.get(loginB) ?? 99) ||
        b.viewerCount - a.viewerCount,
    )
    .map(([login, stream]): SelectedStream => ({
      ...stream,
      reason: "watchlist",
      priority: priorities.get(login),
    }));

  const picked = watchlisted.slice(0, cap);
  const taken = new Set(picked.map((stream) => normalizeLogin(stream.streamerLogin)));

  const fill = input.directory
    .filter((stream) => {
      const login = normalizeLogin(stream.streamerLogin);
      if (taken.has(login) || !passesFilters(stream)) return false;
      if (allow.size > 0 && !allow.has(login)) return false;
      return true;
    })
    .sort((a, b) => b.viewerCount - a.viewerCount);

  for (const stream of fill) {
    if (picked.length >= cap) break;
    const login = normalizeLogin(stream.streamerLogin);
    if (taken.has(login)) continue;
    taken.add(login);
    picked.push({ ...stream, reason: "top-viewers" });
  }
  return picked;
}
