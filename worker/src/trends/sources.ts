import { getLogger } from "@gta6-clipper/shared";
import { normalizeText, type TrendTerm } from "./normalize";

const log = getLogger("worker.trends");

export type FetchOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  language?: string;
};

const SUGGEST_URL = "https://suggestqueries.google.com/complete/search";

/**
 * Public autocomplete (no key). `ds=yt` returns what people type into
 * YouTube search; without it, Google web search. Rank i of n -> weight
 * 1.0 down to ~0.55. Returns [] on any failure.
 */
export async function fetchAutocomplete(
  seed: string,
  target: "youtube" | "google",
  options: FetchOptions = {},
): Promise<TrendTerm[]> {
  const params = new URLSearchParams({
    client: "firefox",
    hl: options.language ?? "en",
    q: seed,
  });
  if (target === "youtube") params.set("ds", "yt");
  try {
    const response = await (options.fetchImpl ?? fetch)(`${SUGGEST_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
      headers: { "user-agent": "Mozilla/5.0 (gta6-clipper trend probe)" },
    });
    if (!response.ok) return [];
    const payload = JSON.parse(await response.text()) as unknown;
    if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];
    const suggestions = (payload[1] as unknown[]).filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    return suggestions.slice(0, 15).map((term, index) => ({
      term: term.trim().toLowerCase(),
      weight: Number(Math.max(0.4, 1 - index * 0.05).toFixed(2)),
      source: target === "youtube" ? ("youtube-suggest" as const) : ("google-suggest" as const),
    }));
  } catch (error) {
    log.debug(
      { seed, target, err: error instanceof Error ? error.name : "unknown" },
      "Autocomplete request failed",
    );
    return [];
  }
}

/**
 * Optional: most-viewed GTA 6 videos of the past week (YouTube Data API,
 * 100 quota units per call). Recurring 2-3 word phrases in their titles
 * become terms. The key is only sent to googleapis.com, never logged.
 */
export async function fetchYouTubeTitleTerms(
  apiKey: string,
  options: FetchOptions & { now?: number } = {},
): Promise<TrendTerm[]> {
  const publishedAfter = new Date((options.now ?? Date.now()) - 7 * 86_400_000).toISOString();
  const params = new URLSearchParams({
    part: "snippet",
    q: "gta 6",
    type: "video",
    order: "viewCount",
    maxResults: "50",
    publishedAfter,
    relevanceLanguage: options.language ?? "en",
    key: apiKey,
  });
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
      { signal: AbortSignal.timeout(options.timeoutMs ?? 8_000) },
    );
    if (!response.ok) {
      log.info({ status: response.status }, "YouTube Data API trend query failed");
      return [];
    }
    const payload = (await response.json()) as {
      items?: { snippet?: { title?: string } }[];
    };
    const titles = (payload.items ?? [])
      .map((item) => item.snippet?.title ?? "")
      .filter(Boolean)
      .map(decodeEntities);
    return phrasesFromTitles(titles);
  } catch (error) {
    log.info(
      { err: error instanceof Error ? error.name : "unknown" },
      "YouTube Data API trend query failed",
    );
    return [];
  }
}

const TITLE_STOP = new Set([
  "gta",
  "6",
  "the",
  "a",
  "an",
  "in",
  "on",
  "of",
  "and",
  "to",
  "for",
  "with",
  "is",
  "i",
  "my",
  "you",
  "this",
  "it",
  "we",
  "vs",
  "new",
]);

/** Recurring 2-3 word phrases (>= 3 titles) as "gta 6 <phrase>" terms. */
export function phrasesFromTitles(titles: readonly string[]): TrendTerm[] {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const words = normalizeText(title)
      .split(" ")
      .filter((word) => word && !TITLE_STOP.has(word));
    const seen = new Set<string>();
    for (let size = 2; size <= 3; size += 1) {
      for (let i = 0; i + size <= words.length; i += 1) {
        const phrase = words.slice(i, i + size).join(" ");
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([phrase, count]) => ({
      term: `gta 6 ${phrase}`,
      weight: Number(Math.min(0.9, 0.5 + 0.05 * count).toFixed(2)),
      source: "youtube-api" as const,
    }));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
}
