import path from "node:path";
import { getAutoSettings, getConfig } from "@gta6-clipper/shared";
import { scoreClipTrends } from "./score";
import { TrendStore } from "./store";

/**
 * `npm run trends --workspace=worker [-- --refresh] [-- "transcript to score"]`
 * Prints the live GTA 6 trend topics (and optionally scores a transcript).
 * Read-only apart from data/trends-cache.json. Never prints keys.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const forceRefresh = args.includes("--refresh");
  const transcript = args.filter((arg) => !arg.startsWith("--")).join(" ");
  const settings = getAutoSettings();
  let youtubeApiKey: string | undefined;
  try {
    youtubeApiKey = getConfig().YOUTUBE_API_KEY;
  } catch {
    youtubeApiKey = undefined;
  }
  const store = new TrendStore({
    cachePath: path.join(settings.dataDir, "trends-cache.json"),
    ttlMs: settings.trends.ttlMs,
    language: settings.trends.language,
    youtubeSeeds: settings.trends.seeds,
    youtubeApiKey,
    firstLoadTimeoutMs: 30_000,
  });
  if (forceRefresh) await store.refresh();
  const topics = await store.getTopics();
  const cache = store.getCache();
  console.log(
    JSON.stringify(
      {
        enabled: settings.trends.enabled,
        fetchedAt: cache?.fetchedAt ?? null,
        sourceCounts: cache?.sourceCounts ?? {},
        youtubeApiKey: youtubeApiKey ? "set" : "not set",
        topics: topics.length,
        top: topics.slice(0, 30).map((topic) => `${topic.label} (${topic.weight})`),
      },
      null,
      2,
    ),
  );
  if (transcript) {
    const result = await scoreClipTrends(
      { transcript, reasons: [], reactionScore: 50 },
      { topics, settings: settings.trends },
    );
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
