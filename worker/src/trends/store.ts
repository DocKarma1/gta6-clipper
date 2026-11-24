import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLogger } from "@gta6-clipper/shared";
import { curatedTerms, DEFAULT_GOOGLE_SEEDS, DEFAULT_YOUTUBE_SEEDS } from "./fallback";
import { buildTopics, type TrendSource, type TrendTerm, type TrendTopic } from "./normalize";
import { fetchAutocomplete, fetchYouTubeTitleTerms } from "./sources";

const log = getLogger("worker.trends");
/** Back-off before retrying after a refresh that returned nothing. */
const RETRY_MS = 15 * 60_000;

export type TrendCache = {
  version: 1;
  fetchedAt: string;
  /** Terms per live source in the last refresh (0 = that source failed). */
  sourceCounts: Partial<Record<TrendSource, number>>;
  terms: TrendTerm[];
};

export type TrendStoreOptions = {
  /** e.g. data/trends-cache.json */
  cachePath: string;
  ttlMs: number;
  youtubeSeeds?: readonly string[];
  googleSeeds?: readonly string[];
  language?: string;
  youtubeApiKey?: string | undefined;
  fetchImpl?: typeof fetch;
  /** Cap on a refresh the caller waits for (first run with no cache). */
  firstLoadTimeoutMs?: number;
  now?: () => number;
};

/** Anything that can hand the scorer a topic list. */
export interface TrendProvider {
  getTopics(): Promise<TrendTopic[]>;
}

/**
 * Live GTA 6 search terms with a JSON file cache and a curated offline list.
 * Never throws: network or disk failures fall back to the last cache, then to
 * the curated topics.
 */
export class TrendStore implements TrendProvider {
  private cache: TrendCache | undefined;
  private topics: TrendTopic[] | undefined;
  private loaded = false;
  private refreshing: Promise<void> | undefined;
  private lastAttemptMs: number | undefined;
  private readonly now: () => number;

  constructor(private readonly options: TrendStoreOptions) {
    this.now = options.now ?? Date.now;
  }

  async getTopics(): Promise<TrendTopic[]> {
    if (!this.loaded) await this.loadFromDisk();
    const retryDue =
      this.lastAttemptMs === undefined || this.now() - this.lastAttemptMs >= RETRY_MS;
    if (!this.cache && retryDue) {
      // First run: wait briefly for live terms; curated topics if that is slow.
      await Promise.race([this.refresh(), delay(this.options.firstLoadTimeoutMs ?? 8_000)]);
    } else if (this.cache && this.isStale()) {
      void this.refresh();
    }
    if (!this.topics) this.topics = buildTopics(this.mergedTerms());
    return this.topics;
  }

  /** Snapshot for logs and the CLI. */
  getCache(): TrendCache | undefined {
    return this.cache;
  }

  isStale(): boolean {
    if (!this.cache) return true;
    const fetchedAt = Date.parse(this.cache.fetchedAt);
    return !Number.isFinite(fetchedAt) || this.now() - fetchedAt >= this.options.ttlMs;
  }

  /** Fetch every source once; concurrent callers share one refresh. */
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    this.lastAttemptMs = this.now();
    const fetchOptions = {
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      language: this.options.language ?? "en",
    };
    const youtubeSeeds = this.options.youtubeSeeds?.length
      ? this.options.youtubeSeeds
      : DEFAULT_YOUTUBE_SEEDS;
    const googleSeeds = this.options.googleSeeds ?? DEFAULT_GOOGLE_SEEDS;
    try {
      const [youtube, google, api] = await Promise.all([
        mapLimit(youtubeSeeds, 3, (seed) => fetchAutocomplete(seed, "youtube", fetchOptions)),
        mapLimit(googleSeeds, 3, (seed) => fetchAutocomplete(seed, "google", fetchOptions)),
        this.options.youtubeApiKey
          ? fetchYouTubeTitleTerms(this.options.youtubeApiKey, {
              ...fetchOptions,
              now: this.now(),
            })
          : Promise.resolve([] as TrendTerm[]),
      ]);
      const terms = [...youtube.flat(), ...google.flat(), ...api];
      const sourceCounts: TrendCache["sourceCounts"] = {
        "youtube-suggest": youtube.flat().length,
        "google-suggest": google.flat().length,
        ...(this.options.youtubeApiKey ? { "youtube-api": api.length } : {}),
      };
      if (terms.length === 0) {
        log.info("No live trend terms (offline?); keeping cached or curated topics");
        // Retry after a short back-off rather than hammering every clip.
        if (this.cache) this.cache = { ...this.cache, fetchedAt: this.retryStamp() };
        return;
      }
      this.cache = {
        version: 1,
        fetchedAt: new Date(this.now()).toISOString(),
        sourceCounts,
        terms,
      };
      this.topics = undefined;
      await this.writeCache(this.cache);
      log.info({ sourceCounts, topics: this.mergedTopicsCount() }, "Refreshed GTA 6 trend terms");
    } catch (error) {
      log.warn(
        { err: error instanceof Error ? error.message : "unknown" },
        "Trend refresh failed; using cached or curated topics",
      );
    }
  }

  /** Live terms first (higher weight wins in buildTopics), curated underneath. */
  private mergedTerms(): TrendTerm[] {
    return [...(this.cache?.terms ?? []), ...curatedTerms()];
  }

  private mergedTopicsCount(): number {
    this.topics = buildTopics(this.mergedTerms());
    return this.topics.length;
  }

  /** Pretend the cache is 15 minutes from expiry so a failed refresh retries soon. */
  private retryStamp(): string {
    const retryIn = Math.min(this.options.ttlMs, RETRY_MS);
    return new Date(this.now() - this.options.ttlMs + retryIn).toISOString();
  }

  private async loadFromDisk(): Promise<void> {
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.options.cachePath, "utf8")) as TrendCache;
      if (parsed?.version === 1 && Array.isArray(parsed.terms)) {
        this.cache = {
          ...parsed,
          terms: parsed.terms.filter(
            (item) => typeof item?.term === "string" && typeof item.weight === "number",
          ),
        };
        this.topics = undefined;
      }
    } catch {
      // No cache yet or unreadable: refresh will create it.
    }
  }

  private async writeCache(cache: TrendCache): Promise<void> {
    try {
      await mkdir(path.dirname(this.options.cachePath), { recursive: true });
      const tmp = `${this.options.cachePath}.partial`;
      await writeFile(tmp, `${JSON.stringify(cache, null, 2)}\n`);
      await rename(tmp, this.options.cachePath);
    } catch (error) {
      log.debug(
        { err: error instanceof Error ? error.message : "unknown" },
        "Could not write the trend cache",
      );
    }
  }
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
