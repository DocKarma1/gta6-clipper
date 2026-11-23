import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { FacecamCache, FACECAM_MIN_CONFIDENCE, scaleCropRect, shouldUseFacecam } from "./facecam";

describe("scaleCropRect", () => {
  it("scales a thumbnail rect onto a 1920x1080 source and keeps even pixels", () => {
    const rect = scaleCropRect(
      { x: 24, y: 24, width: 280, height: 210 },
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
    );
    assert.equal(rect.x % 2, 0);
    assert.equal(rect.width % 2, 0);
    assert.equal(rect.x, 36);
    assert.equal(rect.width, 420);
    assert.equal(rect.height, 316);
  });
});

describe("shouldUseFacecam", () => {
  it("falls back when confidence is below the threshold", () => {
    const weak = {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      confidence: FACECAM_MIN_CONFIDENCE - 0.1,
      method: "face",
      sourceWidth: 1280,
      sourceHeight: 720,
    };
    const strong = { ...weak, confidence: 0.8 };
    assert.equal(shouldUseFacecam(undefined), false);
    assert.equal(shouldUseFacecam(weak), false);
    assert.equal(shouldUseFacecam(strong), true);
  });
});

describe("FacecamCache", () => {
  it("returns a per-channel rect inside the TTL and misses after it expires", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "facecam-cache-"));
    const filePath = path.join(dir, "cache.json");
    const cache = new FacecamCache(filePath, 60_000);
    const detection = {
      rect: { x: 10, y: 10, width: 80, height: 60 },
      confidence: 0.9,
      method: "rectangle",
      sourceWidth: 1280,
      sourceHeight: 720,
    };
    cache.set("ohnepixel", detection);
    assert.equal(cache.get("ohnepixel")?.confidence, 0.9);
    await writeFile(
      filePath,
      JSON.stringify([
        {
          ...detection,
          channelLogin: "old",
          detectedAt: Date.now() - 120_000,
        },
      ]),
    );
    const stale = new FacecamCache(filePath, 60_000);
    assert.equal(stale.get("old"), undefined);
  });
});
