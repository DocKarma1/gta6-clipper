import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FRAME_HEIGHT, FRAME_WIDTH, getSafeZone, getTextPlacement } from "@gta6-clipper/shared";
import {
  assPositionOverride,
  buildAssDocument,
  escapeAssText,
  formatAssTime,
  groupPhrases,
} from "./ass";

const words = [
  { start: 0.2, end: 0.55, text: "He" },
  { start: 0.55, end: 0.85, text: "did" },
  { start: 0.85, end: 1.15, text: "NOT" },
  { start: 1.15, end: 1.5, text: "just" },
  { start: 1.5, end: 1.9, text: "do" },
  { start: 1.9, end: 2.5, text: "that" },
];

describe("ASS escaping and timing", () => {
  it("escapes braces, backslashes, and newlines", () => {
    assert.equal(escapeAssText("foo{bar}\\baz\nend"), "foo\\{bar\\}\\\\baz\\Nend");
  });

  it("formats centisecond timestamps", () => {
    assert.equal(formatAssTime(0), "0:00:00.00");
    assert.equal(formatAssTime(61.259), "0:01:01.26");
    assert.equal(formatAssTime(-1), "0:00:00.00");
  });
});

describe("buildAssDocument", () => {
  it("uses 1080x1920 PlayRes and clips every event to the safe zone", () => {
    const zone = getSafeZone();
    const document = buildAssDocument({
      layout: { layout: "blurred-background", hookTitle: "HE DID {WHAT}?" },
      words,
      credit: { login: "testDriver" },
      durationSeconds: 4,
    });
    assert.match(document, new RegExp(`PlayResX: ${FRAME_WIDTH}`));
    assert.match(document, new RegExp(`PlayResY: ${FRAME_HEIGHT}`));
    assert.match(document, /Style: Caption,/);
    assert.match(document, /Style: Title,/);
    assert.match(document, /Style: Credit,/);
    assert.match(document, /twitch\.tv\/testDriver/);
    assert.match(document, /HE DID \\\{WHAT\\\}\?/);
    assert.match(document, new RegExp(`\\\\clip\\(0,0,${zone.right},${zone.bottom}\\)`));
    const events = document.split("\n").filter((line) => line.startsWith("Dialogue:"));
    assert.ok(events.length > 2);
    for (const event of events) {
      assert.match(event, new RegExp(`\\\\clip\\(0,0,${zone.right},${zone.bottom}\\)`));
      const pos = event.match(/\\pos\((\d+),(\d+)\)/);
      assert.ok(pos);
      const x = Number(pos[1]);
      const y = Number(pos[2]);
      assert.ok(x <= zone.right, `pos x ${x} exceeds safe right ${zone.right}`);
      assert.ok(y <= zone.bottom, `pos y ${y} exceeds safe bottom ${zone.bottom}`);
    }
  });

  it("places stacked-split captions near the seam and highlights the active word", () => {
    const layout = {
      layout: "stacked-split" as const,
      facecam: { x: 1480, y: 40, width: 400, height: 300 },
    };
    const placement = getTextPlacement({
      layout,
      source: { width: 1920, height: 1080 },
    });
    const document = buildAssDocument({
      layout,
      words,
      credit: { login: "clipper", format: "at" },
      durationSeconds: 4,
      source: { width: 1920, height: 1080 },
    });
    assert.match(document, /@clipper/);
    assert.ok(
      !document
        .split("\n")
        .some((line) => line.startsWith("Dialogue:") && line.includes(",Title,,")),
    );
    const expected = assPositionOverride(placement.caption, getSafeZone());
    assert.ok(document.includes(expected));
    assert.match(document, /\\c&H0000FFFF&/);
    assert.match(document, /\\t\(0,90,\\fscx115\\fscy115\)/);
    assert.match(document, /0:00:01\.50,0:00:01\.90,Caption,/);
  });

  it("groups words into phrases across long pauses", () => {
    const phrases = groupPhrases([
      { start: 0, end: 0.3, text: "one" },
      { start: 0.3, end: 0.6, text: "two" },
      { start: 2.0, end: 2.3, text: "three" },
    ]);
    assert.equal(phrases.length, 2);
    assert.deepEqual(
      phrases[0]?.words.map((word) => word.text),
      ["one", "two"],
    );
  });
});
