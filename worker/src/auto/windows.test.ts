import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CandidateMoment } from "@gta6-clipper/shared";
import { windowForQuestion, windowForSpike, windowOverlap } from "./windows";

const settings = {
  chatDelaySeconds: 3,
  preRollSeconds: 10,
  postRollSeconds: 5,
  minClipSeconds: 15,
  maxClipSeconds: 45,
};

const moment = (extra: Partial<CandidateMoment>): CandidateMoment => ({
  id: "m",
  channelLogin: "ohnepixel",
  channelId: undefined,
  startedAt: "2026-11-23T15:34:29.800Z",
  peakAt: "2026-11-23T15:34:34.800Z",
  hypeScore: 60,
  reasons: [],
  messageRate: 16,
  baselineRate: 8.7,
  zScore: 2,
  ...extra,
});

describe("clip windows", () => {
  it("starts a question clip just before the question and ends after the reply peak", () => {
    const w = windowForQuestion(
      moment({ kind: "question_reply", questionAt: "2026-11-23T15:34:25.600Z" }),
      settings,
    );
    assert.equal(new Date(w.startMs).toISOString(), "2026-11-23T15:34:23.100Z");
    assert.ok(w.endMs >= Date.parse("2026-11-23T15:34:36.800Z"));
    assert.ok(w.endMs - w.startMs >= 15_000);
  });

  it("detects overlapping spike windows for dedupe", () => {
    const a = windowForSpike(moment({}), settings);
    const b = windowForSpike(
      moment({ startedAt: "2026-11-23T15:34:33.000Z", peakAt: "2026-11-23T15:34:36.000Z" }),
      settings,
    );
    assert.ok(windowOverlap(a, b) > 0.5);
  });
});
