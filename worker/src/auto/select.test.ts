import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AutoSettings, type LiveStream } from "@gta6-clipper/shared";
import { selectStreams } from "./select";

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

const base: AutoSettings = {
  topK: 3,
  pollIntervalMs: 60_000,
  languages: [],
  allowList: [],
  denyList: [],
  requirePermission: true,
  permittedChannels: [],
  writeLocalOnly: true,
  segmentSeconds: 10,
  bufferSeconds: 120,
  preRollSeconds: 20,
  postRollSeconds: 10,
  cooldownSeconds: 60,
  runSeconds: undefined,
  dataDir: "/tmp/data",
  streamlinkPath: "streamlink",
};

const pool = [
  stream("alpha", 1000),
  stream("bravo", 800, "sv"),
  stream("charlie", 600),
  stream("delta", 400),
];

describe("selectStreams", () => {
  it("returns no streams when permission is required and the allowlist is empty", () => {
    assert.deepEqual(selectStreams(pool, base), []);
  });

  it("keeps only permitted channels and the top K by viewers", () => {
    const result = selectStreams(pool, {
      ...base,
      permittedChannels: ["delta", "alpha", "charlie"],
      topK: 2,
    });
    assert.deepEqual(
      result.map((item) => item.streamerLogin),
      ["alpha", "charlie"],
    );
  });

  it("honours language filters, deny lists, and an allow list when permission is off", () => {
    const result = selectStreams(pool, {
      ...base,
      requirePermission: false,
      languages: ["en"],
      denyList: ["alpha"],
      allowList: ["alpha", "bravo", "charlie", "delta"],
      topK: 3,
    });
    assert.deepEqual(
      result.map((item) => item.streamerLogin),
      ["charlie", "delta"],
    );
  });
});
