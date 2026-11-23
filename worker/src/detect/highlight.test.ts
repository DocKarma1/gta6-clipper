import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alignWordsToWindow,
  findOnsetSecond,
  findPeakSecond,
  parseSceneCuts,
  parseSilenceDetect,
  planClipWindow,
  smoothBins,
  snapWindow,
} from "./highlight";

const bins = (values: number[], from = 100) =>
  values.map((messages, i) => ({ second: from + i, messages }));

describe("peak finding", () => {
  it("smooths single-second noise and finds the sustained peak", () => {
    // A 1-second blip of 12 at 101 vs a sustained hump around 105.
    const smoothed = smoothBins(bins([1, 12, 1, 4, 9, 11, 10, 3, 1]));
    assert.equal(findPeakSecond(smoothed), 105);
  });

  it("fills missing seconds with zero", () => {
    const smoothed = smoothBins([
      { second: 10, messages: 3 },
      { second: 13, messages: 3 },
    ]);
    assert.equal(smoothed.length, 4);
    assert.equal(smoothed[1]?.messages, 1);
  });

  it("walks back to the onset above the threshold", () => {
    const smoothed = smoothBins(bins([1, 1, 1, 4, 8, 12, 9, 3]));
    assert.equal(findOnsetSecond(smoothed, 105, 2), 103);
  });
});

describe("planClipWindow", () => {
  const base = {
    chatDelaySeconds: 3,
    preRollSeconds: 10,
    postRollSeconds: 5,
    minSeconds: 15,
    maxSeconds: 45,
  };

  it("leads in before the chat-derived event and ends shortly after the peak", () => {
    const w = planClipWindow({
      ...base,
      burstStartMs: 100_000,
      peakMs: 104_000,
      burstEndMs: 108_000,
    });
    assert.equal(w.eventMs, 97_000);
    assert.equal(w.peakVideoMs, 101_000);
    // lead-in 10 + 0.5*8 = 14 s before the event
    assert.equal(w.startMs, 83_000);
    assert.equal(w.endMs, 106_000);
  });

  it("extends short windows mostly at the start", () => {
    const w = planClipWindow({
      ...base,
      preRollSeconds: 3,
      postRollSeconds: 2,
      burstStartMs: 100_000,
      peakMs: 100_000,
      burstEndMs: 100_000,
    });
    assert.equal(w.endMs - w.startMs, 15_000);
    assert.ok(w.startMs < 94_000);
  });

  it("trims long windows from the start but keeps 3 s before the event", () => {
    const w = planClipWindow({
      ...base,
      maxSeconds: 20,
      preRollSeconds: 30,
      burstStartMs: 100_000,
      peakMs: 110_000,
      burstEndMs: 120_000,
    });
    assert.equal(w.endMs - w.startMs, 20_000);
    assert.ok(w.startMs <= w.eventMs - 3_000);
    assert.ok(w.endMs >= w.peakVideoMs);
  });
});

describe("snapWindow", () => {
  const window = { startMs: 10_000, endMs: 40_000, eventMs: 20_000, peakVideoMs: 30_000 };

  it("snaps the start to a silence end and the end to a scene cut nearby", () => {
    const snapped = snapWindow(window, {
      silences: [{ startMs: 8_500, endMs: 9_400 }],
      sceneCuts: [40_900, 55_000],
    });
    assert.equal(snapped.startMs, 9_400);
    assert.equal(snapped.snappedStart, "silence");
    assert.equal(snapped.endMs, 40_900);
    assert.equal(snapped.snappedEnd, "scene");
  });

  it("does not move cuts that are too far away or past the event/peak guards", () => {
    const snapped = snapWindow(window, {
      silences: [{ startMs: 30_500, endMs: 31_000 }],
      sceneCuts: [5_000, 19_000],
    });
    assert.equal(snapped.startMs, 10_000);
    assert.equal(snapped.endMs, 40_000);
    assert.equal(snapped.snappedStart, "none");
  });
});

describe("ffmpeg parsers and caption alignment", () => {
  it("parses silencedetect and showinfo output", () => {
    const silence = parseSilenceDetect(
      "[silencedetect @ 0x1] silence_start: 1.5\n[silencedetect @ 0x1] silence_end: 2.25 | silence_duration: 0.75\n",
    );
    assert.deepEqual(silence, [{ start: 1.5, end: 2.25 }]);
    const cuts = parseSceneCuts(
      "[Parsed_showinfo_1 @ 0x2] n:   0 pts:  12345 pts_time:4.1 duration:1\nother line pts_time:9\n",
    );
    assert.deepEqual(cuts, [4.1]);
  });

  it("shifts caption words into clip time and drops words outside the window", () => {
    const words = [
      { text: "before", start: 1, end: 1.5 },
      { text: "edge", start: 4.8, end: 5.4 },
      { text: "inside", start: 8, end: 8.4 },
      { text: "after", start: 30, end: 30.5 },
    ];
    const aligned = alignWordsToWindow(words, 5, 20);
    assert.deepEqual(
      aligned.map((w) => [w.text, w.start, w.end]),
      [
        ["edge", 0, 0.4],
        ["inside", 3, 3.4],
      ],
    );
  });
});
