import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChannelSpikeDetector } from "./spikes";
import type { ChatEvent } from "@gta6-clipper/shared";

function event(atMs: number, user: string, text: string, emotes: string[] = []): ChatEvent {
  return {
    channelLogin: "alpha",
    userLogin: user,
    text,
    emoteTokens: emotes,
    receivedAt: new Date(atMs).toISOString(),
  };
}

describe("ChannelSpikeDetector", () => {
  it("does not fire during a quiet baseline", () => {
    const detector = new ChannelSpikeDetector("alpha", { cooldownMs: 1_000, minScore: 55 });
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    const hits: number[] = [];
    for (let second = 0; second < 40; second += 1) {
      const moment = detector.ingest(event(start + second * 1000, `user${second % 3}`, "nice"));
      if (moment) hits.push(second);
    }
    assert.equal(hits.length, 0);
  });

  it("emits a scored moment on a CLIP IT + emote flood after a quiet baseline", () => {
    const detector = new ChannelSpikeDetector("alpha", { cooldownMs: 30_000, minScore: 50 });
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    for (let second = 0; second < 40; second += 1) {
      detector.ingest(event(start + second * 1000, `lurker${second % 4}`, "waiting"));
    }
    const spikeAt = start + 41_000;
    let moment = null;
    for (let i = 0; i < 16; i += 1) {
      const text = i % 3 === 0 ? "CLIP IT" : "LUL KEKW LUL";
      moment = detector.ingest(event(spikeAt + i * 80, `fan${i}`, text, ["LUL", "KEKW"])) ?? moment;
    }
    assert.ok(moment);
    assert.ok(moment.hypeScore >= 50);
    assert.ok(moment.hypeScore <= 100);
    assert.ok(
      moment.reasons.some(
        (reason) => reason.includes("clip") || reason === "emote-flood" || reason === "rate-spike",
      ),
    );
    assert.equal(moment.channelLogin, "alpha");
  });

  it("respects cooldown so one joke does not emit overlapping clips", () => {
    const detector = new ChannelSpikeDetector("alpha", { cooldownMs: 60_000, minScore: 40 });
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    for (let second = 0; second < 40; second += 1) {
      detector.ingest(event(start + second * 1000, `lurker${second % 4}`, "ok"));
    }
    const firstWave = start + 41_000;
    let first = null;
    let second = null;
    for (let i = 0; i < 14; i += 1) {
      first = detector.ingest(event(firstWave + i * 50, `fan${i}`, "CLIP IT LUL")) ?? first;
    }
    for (let i = 0; i < 14; i += 1) {
      second =
        detector.ingest(event(firstWave + 2_000 + i * 50, `fan${i}`, "CLIP IT LUL")) ?? second;
    }
    assert.ok(first);
    assert.equal(second, null);
  });
});
