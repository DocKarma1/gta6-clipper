import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildCopyPrompt } from "../ai/titles";
import { OllamaClient } from "../ai/ollama";
import { curatedTerms } from "./fallback";
import { buildTopics, textTokens, topicTokens } from "./normalize";
import {
  evaluateTrends,
  matchTrends,
  scoreClipTrends,
  searchableTopics,
  trendScoreFromMatches,
} from "./score";
import { fetchAutocomplete, phrasesFromTitles } from "./sources";
import { TrendStore } from "./store";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const suggest = (query: string, items: string[]) => json([query, items, [], {}]);

const settings = { weight: 0.25, minScore: undefined, minCombinedScore: undefined };

describe("trend normalization", () => {
  it("strips GTA 6 spellings and fillers, folds synonyms", () => {
    assert.deepEqual(topicTokens("GTA VI funniest NPC moments"), ["funny", "npc"]);
    assert.deepEqual(topicTokens("grand theft auto 6 police chase"), ["police", "chase"]);
    assert.deepEqual([...textTokens("the cops were chasing us lmao")].sort(), [
      "chase",
      "funny",
      "police",
      "us",
      "were",
    ]);
  });

  it("drops news-only topics that never happen on stream", () => {
    assert.equal(topicTokens("gta 6 release date"), undefined);
    assert.equal(topicTokens("gta 6 pc price"), undefined);
    assert.equal(topicTokens("gta 6"), undefined);
  });

  it("merges duplicate topics, keeping the strongest label and weight", () => {
    const topics = buildTopics([
      { term: "gta 6 police chase", weight: 0.6, source: "curated" },
      { term: "gta 6 cop chase", weight: 0.9, source: "youtube-suggest" },
    ]);
    assert.equal(topics.length, 1);
    assert.equal(topics[0]?.label, "gta 6 cop chase");
    assert.equal(topics[0]?.weight, 0.95);
    assert.deepEqual(topics[0]?.sources, ["curated", "youtube-suggest"]);
  });
});

describe("trend matching and scoring", () => {
  const topics = buildTopics(curatedTerms());

  it("matches transcript phrases with synonyms", () => {
    const matches = matchTrends(
      { transcript: "Bro the cops are chasing me, five stars!", reasons: ["rate-spike"] },
      topics,
    );
    assert.equal(matches[0]?.label, "gta 6 police chase");
    assert.equal(matches[0]?.via, "transcript");
    assert.ok(trendScoreFromMatches(matches) > 0);
  });

  it("uses chat reasons as weak hints only", () => {
    const matches = matchTrends({ transcript: "no way", reasons: ["emote-flood"] }, topics);
    const funny = matches.find((match) => match.label === "gta 6 funny moments");
    assert.equal(funny?.via, "chat");
    assert.equal(funny?.confidence, 0.5);
  });

  it("keeps reaction primary: no match = no boost, nothing dropped by default", () => {
    const result = evaluateTrends({ reactionScore: 62, matches: [] }, settings);
    assert.equal(result.trendScore, 0);
    assert.equal(result.combinedScore, 62);
    assert.equal(result.decision, "keep");
  });

  it("boosts by weight x trend score", () => {
    const matches = matchTrends({ transcript: "that was a crazy glitch", reasons: [] }, topics);
    const result = evaluateTrends({ reactionScore: 40, matches }, settings);
    assert.ok(result.trendScore > 0);
    assert.equal(result.boost, Number((0.25 * result.trendScore).toFixed(1)));
    assert.equal(result.combinedScore, Number((40 + result.boost).toFixed(1)));
  });

  it("only filters when a gate is configured", () => {
    const skipTrend = evaluateTrends(
      { reactionScore: 90, matches: [] },
      { ...settings, minScore: 20 },
    );
    assert.equal(skipTrend.decision, "skip");
    assert.match(skipTrend.skipReason ?? "", /TREND_MIN_SCORE/);
    const matches = matchTrends({ transcript: "police chase", reasons: [] }, topics);
    const rescued = evaluateTrends(
      { reactionScore: 40, matches },
      { ...settings, minCombinedScore: 50 },
    );
    assert.equal(rescued.decision, "keep");
    const dropped = evaluateTrends(
      { reactionScore: 40, matches: [] },
      { ...settings, minCombinedScore: 50 },
    );
    assert.equal(dropped.decision, "skip");
  });

  it("adds Ollama tags from the candidate list only and survives Ollama being down", async () => {
    const { fetch } = mockFetch((url) => {
      if (url.endsWith("/api/tags")) return json({ models: [] });
      return json({
        message: { content: JSON.stringify({ topics: ["gta 6 heist", "made up topic"] }) },
      });
    });
    const client = new OllamaClient({ baseUrl: "http://o:11434", model: "m", fetchImpl: fetch });
    const result = await scoreClipTrends(
      {
        transcript: "we are taking everything from the vault tonight",
        reasons: [],
        reactionScore: 50,
      },
      { topics, settings, ollama: client },
    );
    const labels = result.matches.map((match) => match.label);
    assert.ok(labels.includes("gta 6 heist"));
    assert.ok(!labels.includes("made up topic"));

    const down = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const offline = new OllamaClient({
      baseUrl: "http://o:11434",
      model: "m",
      fetchImpl: down.fetch,
    });
    const fallback = await scoreClipTrends(
      { transcript: "nothing special here at all", reasons: [], reactionScore: 50 },
      { topics, settings, ollama: offline },
    );
    assert.equal(fallback.decision, "keep");
    assert.equal(fallback.combinedScore, 50);
  });

  it("passes matched topics to the title prompt as searchable topics", () => {
    const matches = matchTrends({ transcript: "the cops are chasing me", reasons: [] }, topics);
    const base = {
      planId: "pro" as const,
      transcript: "the cops are chasing me",
      streamTitle: "GTA 6",
      channelLogin: "caseoh_",
      reasons: ["rate-spike"],
    };
    const withTopics = buildCopyPrompt({ ...base, trendTopics: searchableTopics(matches) });
    assert.match(withTopics.prompt, /Searchable topics: gta 6 police chase/);
    assert.match(withTopics.system, /never add events/);
    const without = buildCopyPrompt(base);
    assert.doesNotMatch(without.prompt, /Searchable topics/);
  });
});

describe("trend sources", () => {
  it("parses autocomplete with rank weights and survives errors", async () => {
    const { fetch, calls } = mockFetch(() =>
      suggest("gta 6 funny", ["gta 6 funny moments", "gta 6 funny npc"]),
    );
    const terms = await fetchAutocomplete("gta 6 funny", "youtube", { fetchImpl: fetch });
    assert.equal(terms.length, 2);
    assert.equal(terms[0]?.weight, 1);
    assert.equal(terms[1]?.weight, 0.95);
    assert.equal(terms[0]?.source, "youtube-suggest");
    assert.match(calls[0] ?? "", /ds=yt/);

    const broken = mockFetch(() => new Response("<html>", { status: 200 }));
    assert.deepEqual(await fetchAutocomplete("x", "google", { fetchImpl: broken.fetch }), []);
    const failing = mockFetch(() => {
      throw new TypeError("offline");
    });
    assert.deepEqual(await fetchAutocomplete("x", "google", { fetchImpl: failing.fetch }), []);
  });

  it("turns recurring title phrases into terms", () => {
    const terms = phrasesFromTitles([
      "GTA 6 Police Chase gone wrong",
      "INSANE gta 6 police chase",
      "GTA VI police chase compilation",
      "gta 6 random",
    ]);
    assert.ok(terms.some((term) => term.term === "gta 6 police chase"));
  });
});

describe("trend store", () => {
  it("fetches, caches to disk, and reuses the cache within the TTL", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "trends-"));
    const cachePath = path.join(dir, "trends-cache.json");
    try {
      const { fetch, calls } = mockFetch((url) => {
        const q = new URL(url).searchParams.get("q") ?? "";
        return suggest(q, [`${q} jetski fail`]);
      });
      let now = Date.parse("2026-11-24T00:00:00Z");
      const store = new TrendStore({
        cachePath,
        ttlMs: 6 * 3_600_000,
        youtubeSeeds: ["gta 6"],
        googleSeeds: [],
        fetchImpl: fetch,
        now: () => now,
      });
      const topics = await store.getTopics();
      assert.ok(topics.some((topic) => topic.label === "gta 6 jetski fail"));
      assert.ok(topics.some((topic) => topic.sources.includes("curated")));
      const saved = JSON.parse(await readFile(cachePath, "utf8")) as { terms: unknown[] };
      assert.equal(saved.terms.length, 1);
      assert.equal(calls.length, 1);

      // A second store (new process) reads the file and does not refetch.
      const reread = new TrendStore({
        cachePath,
        ttlMs: 6 * 3_600_000,
        youtubeSeeds: ["gta 6"],
        googleSeeds: [],
        fetchImpl: fetch,
        now: () => now,
      });
      await reread.getTopics();
      assert.equal(calls.length, 1);
      now += 7 * 3_600_000;
      assert.equal(reread.isStale(), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to curated topics offline, and to a stale cache when present", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "trends-"));
    const cachePath = path.join(dir, "trends-cache.json");
    try {
      const offline = mockFetch(() => {
        throw new TypeError("offline");
      });
      const store = new TrendStore({
        cachePath,
        ttlMs: 1_000,
        googleSeeds: [],
        fetchImpl: offline.fetch,
      });
      const topics = await store.getTopics();
      assert.ok(topics.length >= 20);
      assert.ok(topics.every((topic) => topic.sources.includes("curated")));

      await writeFile(
        cachePath,
        JSON.stringify({
          version: 1,
          fetchedAt: "2020-01-01T00:00:00.000Z",
          sourceCounts: {},
          terms: [{ term: "gta 6 jetski fail", weight: 0.9, source: "youtube-suggest" }],
        }),
      );
      const stale = new TrendStore({
        cachePath,
        ttlMs: 1_000,
        googleSeeds: [],
        fetchImpl: offline.fetch,
      });
      const staleTopics = await stale.getTopics();
      assert.ok(staleTopics.some((topic) => topic.label === "gta 6 jetski fail"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
