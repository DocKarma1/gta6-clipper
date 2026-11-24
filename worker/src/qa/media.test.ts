import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  measureSignals,
  parseMomentaryLoudness,
  parseSceneScores,
  probeFormat,
  summarizeLoudness,
  summarizeScenes,
} from "./media";

const EBUR = `[Parsed_ebur128_0 @ 0x1] t: 0.0999773  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x1] t: 0.5        TARGET:-23 LUFS    M: -30.0 S: -30.0     I: -30.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x1] t: 0.6        TARGET:-23 LUFS    M: -31.0 S: -30.0     I: -30.0 LUFS       LRA:   0.0 LU
[Parsed_ebur128_0 @ 0x1] t: 0.7        TARGET:-23 LUFS    M: -12.0 S: -20.0     I: -25.0 LUFS       LRA:   5.0 LU`;

const SCENES = `[Parsed_metadata_2 @ 0x1] frame:0    pts:0       pts_time:0
[Parsed_metadata_2 @ 0x1] lavfi.scene_score=0.000000
[Parsed_metadata_2 @ 0x1] frame:1    pts:512     pts_time:0.0333333
[Parsed_metadata_2 @ 0x1] lavfi.scene_score=0.010000
[Parsed_metadata_2 @ 0x1] lavfi.scene_score=0.450000`;

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("qa media parsing", () => {
  it("parses momentary loudness and computes the spike over the median", () => {
    const frames = parseMomentaryLoudness(EBUR);
    assert.equal(frames.length, 4);
    const summary = summarizeLoudness(frames);
    assert.equal(summary.peak, -12);
    assert.equal(summary.median, -30);
    assert.equal(summary.spike, 18);
    assert.deepEqual(summarizeLoudness([]), {
      peak: undefined,
      median: undefined,
      spike: undefined,
    });
  });

  it("parses scene scores, ignoring the first frame", () => {
    const scores = parseSceneScores(SCENES);
    assert.deepEqual(scores, [0, 0.01, 0.45]);
    assert.deepEqual(summarizeScenes(scores), { max: 0.45, mean: 0.23 });
  });

  it("probes and measures a real file with ffmpeg", { skip: !hasFfmpeg }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-media-"));
    const file = path.join(dir, "v.mp4");
    const made = spawnSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=108x192:rate=15:duration=3",
      "-f",
      "lavfi",
      "-i",
      "sine=f=300:d=3,volume='if(between(t,1.5,2.2),1,0.02)':eval=frame",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      file,
    ]);
    assert.equal(made.status, 0);
    const format = await probeFormat(file);
    assert.equal(format?.width, 108);
    assert.equal(format?.height, 192);
    assert.equal(format?.hasAudio, true);
    const signals = await measureSignals(file, true);
    assert.ok((signals.audioSpikeDb ?? 0) > 10);
    assert.ok(signals.maxSceneScore !== undefined);
    assert.equal(await probeFormat(path.join(dir, "missing.mp4")), undefined);
  });
});
