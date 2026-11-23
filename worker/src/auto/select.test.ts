import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_WATCHLIST,
  effectiveStreamCap,
  watchlistPriorityByLogin,
  type LiveStream,
} from "@gta6-clipper/shared";
import { selectStreams, type SelectionSettings } from "./select";

function stream(login: string, viewers: number, language = "en"): LiveStream {
  return {
    id: login,
    streamerLogin: login,
    streamerName: login,
    title: `${login} live`,
    viewerCount: viewers,
    language,
    thumbnailUrl: "https://example.com/t.jpg",
    url: `https://www.twitch.tv/${login}`,
    startedAt: new Date().toISOString(),
    gameName: "Grand Theft Auto VI",
  };
}

const base: SelectionSettings = { topK: 3, languages: [], allowList: [], denyList: [] };

const pool = [
  stream("alpha", 1000),
  stream("bravo", 800, "sv"),
  stream("charlie", 600),
  stream("delta", 400),
];

const logins = (items: { streamerLogin: string }[]) => items.map((item) => item.streamerLogin);

describe("selectStreams", () => {
  it("fills with the top viewers when no watchlisted streamer is live", () => {
    assert.deepEqual(logins(selectStreams({ directory: pool }, { ...base, topK: 2 })), [
      "alpha",
      "bravo",
    ]);
  });

  it("puts live watchlisted streamers first by priority, then viewers, then fills", () => {
    const priorities = new Map([
      ["delta", 1],
      ["kaicenat", 1],
      ["charlie", 2],
    ]);
    const result = selectStreams(
      { directory: pool, watchlistLive: [stream("kaicenat", 300)], priorities },
      base,
    );
    assert.deepEqual(logins(result), ["delta", "kaicenat", "charlie"]);
    assert.deepEqual(
      result.map((item) => item.reason),
      ["watchlist", "watchlist", "watchlist"],
    );
  });

  it("caps watchlisted picks at topK and never duplicates a streamer", () => {
    const priorities = new Map([["alpha", 1]]);
    const result = selectStreams(
      { directory: pool, watchlistLive: [stream("alpha", 1200)], priorities },
      { ...base, topK: 2 },
    );
    assert.deepEqual(logins(result), ["alpha", "bravo"]);
    assert.equal(result[0]?.viewerCount, 1200);
  });

  it("applies language and deny filters to both lists and the allow list to the fill only", () => {
    const priorities = new Map([
      ["bravo", 1],
      ["kaicenat", 2],
    ]);
    const result = selectStreams(
      { directory: pool, watchlistLive: [stream("kaicenat", 50)], priorities },
      { ...base, languages: ["en"], denyList: ["alpha"], allowList: ["delta"] },
    );
    assert.deepEqual(logins(result), ["kaicenat", "delta"]);
  });
});

describe("stream cap and watchlist", () => {
  it("caps at min(topK, plan, AUTO_MAX_CONCURRENT)", () => {
    assert.equal(effectiveStreamCap({ topK: 10, planId: "studio", maxConcurrent: 3 }), 3);
    assert.equal(effectiveStreamCap({ topK: 10, planId: "starter", maxConcurrent: 3 }), 2);
    assert.equal(effectiveStreamCap({ topK: 1, planId: "pro", maxConcurrent: 3 }), 1);
  });

  it("ships verified watchlist entries including the requested streamers", () => {
    const priorities = watchlistPriorityByLogin(DEFAULT_WATCHLIST);
    for (const login of ["ishowspeed", "fanum", "neon", "kaicenat"]) {
      assert.ok(priorities.has(login), login);
    }
    assert.ok(DEFAULT_WATCHLIST.length >= 10 && DEFAULT_WATCHLIST.length <= 15);
    assert.ok(DEFAULT_WATCHLIST.every((entry) => /^[a-z0-9_]{1,25}$/.test(entry.login)));
    const offTwitch = DEFAULT_WATCHLIST.filter((entry) => entry.platform !== "twitch");
    assert.ok(offTwitch.every((entry) => !entry.captureSupported));
  });
});
