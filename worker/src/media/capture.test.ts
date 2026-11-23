import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSegmentList, pickSegments, type BufferSegment } from "./capture";

const seg = (session: string, index: number, start: number, end: number): BufferSegment => ({
  path: `/tmp/${session}_${index}.ts`,
  session,
  index,
  startedAtMs: start,
  endedAtMs: end,
});

describe("capture buffer timing", () => {
  it("parses the ffmpeg CSV segment list with variable segment lengths", () => {
    const rows = parseSegmentList(
      "s1_00000.ts,0.000000,6.006000\ns1_00001.ts,6.006000,13.513000\nbad\n",
    );
    assert.deepEqual(rows, [
      { name: "s1_00000.ts", start: 0, end: 6.006 },
      { name: "s1_00001.ts", start: 6.006, end: 13.513 },
    ]);
  });

  it("picks contiguous segments and reports what the buffer covers", () => {
    const segments = [seg("a", 0, 0, 6000), seg("a", 1, 6000, 12000), seg("a", 2, 12000, 18000)];
    const { picked, coveredFromMs, coveredToMs } = pickSegments(segments, 7000, 20000);
    assert.deepEqual(
      picked.map((s) => s.index),
      [1, 2],
    );
    assert.equal(coveredFromMs, 7000);
    assert.equal(coveredToMs, 18000);
  });

  it("does not stream-copy across a restart gap", () => {
    const segments = [seg("a", 0, 0, 6000), seg("b", 0, 20000, 26000)];
    const { picked } = pickSegments(segments, 1000, 25000);
    assert.deepEqual(
      picked.map((s) => s.session),
      ["a"],
    );
  });
});
