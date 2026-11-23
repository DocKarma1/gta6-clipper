import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FACECAM_BAND,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SAFE_ZONE,
  TEXT,
  anchorBounds,
  facecamBandHeight,
  formatStreamerCredit,
  gameplayCenterCrop,
  getBlurredBackgroundGeometry,
  getSafeZone,
  getStackedSplitGeometry,
  getTextPlacement,
  isInsideSafeZone,
  resolveFacecamBandFraction,
} from "./video";

describe("safe zone", () => {
  it("reserves the bottom 15% and right 12% of a 1080x1920 frame", () => {
    const zone = getSafeZone();
    assert.equal(zone.insetRight, Math.round(FRAME_WIDTH * SAFE_ZONE.rightFraction));
    assert.equal(zone.insetBottom, Math.round(FRAME_HEIGHT * SAFE_ZONE.bottomFraction));
    assert.equal(zone.right, 950);
    assert.equal(zone.bottom, 1632);
    assert.equal(zone.width, 950);
    assert.equal(zone.height, 1632);
    assert.equal(zone.insetRight, 130);
    assert.equal(zone.insetBottom, 288);
  });

  it("treats the reserved margins as outside the safe zone", () => {
    const zone = getSafeZone();
    assert.equal(isInsideSafeZone({ x: 0, y: 0, width: 950, height: 1632 }, zone), true);
    assert.equal(isInsideSafeZone({ x: 0, y: 0, width: 951, height: 100 }, zone), false);
    assert.equal(isInsideSafeZone({ x: 0, y: 1632, width: 100, height: 1 }, zone), false);
  });
});

describe("facecam band", () => {
  it("defaults to 35% and stays even with an even remainder", () => {
    assert.equal(resolveFacecamBandFraction(undefined), FACECAM_BAND.defaultFraction);
    const band = facecamBandHeight();
    assert.equal(band, 672);
    assert.equal(band % 2, 0);
    assert.equal((FRAME_HEIGHT - band) % 2, 0);
    assert.equal(facecamBandHeight(0.3), 576);
    assert.equal(facecamBandHeight(0.4), 768);
  });

  it("rejects a band fraction outside 30–40%", () => {
    assert.throws(() => resolveFacecamBandFraction(0.29), RangeError);
    assert.throws(() => resolveFacecamBandFraction(0.41), RangeError);
  });
});

describe("text placement", () => {
  const source = { width: 1920, height: 1080 };

  it("keeps stacked-split captions, near the seam, and credit inside the safe zone", () => {
    const layout = {
      layout: "stacked-split" as const,
      facecam: { x: 1480, y: 40, width: 400, height: 300 },
    };
    const placement = getTextPlacement({ layout, source });
    const geometry = getStackedSplitGeometry(layout, source);
    const zone = getSafeZone();

    assert.equal(placement.title, undefined);
    assert.equal(placement.caption.align, "top-center");
    assert.equal(placement.caption.y, geometry.seamY + TEXT.padding);
    assert.equal(placement.caption.x, zone.width / 2);
    assert.ok(placement.caption.y >= geometry.seamY);
    assert.ok(isInsideSafeZone(anchorBounds(placement.caption), zone));
    assert.ok(isInsideSafeZone(anchorBounds(placement.credit), zone));
    assert.ok(anchorBounds(placement.credit).bottom <= zone.bottom);
    assert.ok(anchorBounds(placement.caption).right <= zone.right);
    assert.ok(anchorBounds(placement.credit).right <= zone.right);
  });

  it("places blurred-background title in the top blur and captions in the bottom blur, all inside the safe zone", () => {
    const layout = { layout: "blurred-background" as const, hookTitle: "HE DID WHAT?" };
    const placement = getTextPlacement({ layout });
    const geometry = getBlurredBackgroundGeometry();
    const zone = getSafeZone();

    assert.ok(placement.title);
    const title = anchorBounds(placement.title);
    const caption = anchorBounds(placement.caption);
    const credit = anchorBounds(placement.credit);

    assert.ok(title.bottom <= geometry.foregroundY);
    assert.ok(caption.y >= geometry.foregroundY + geometry.foregroundHeight);
    assert.ok(caption.bottom <= credit.y);
    assert.ok(isInsideSafeZone(title, zone));
    assert.ok(isInsideSafeZone(caption, zone));
    assert.ok(isInsideSafeZone(credit, zone));
    assert.ok(caption.right <= zone.right);
    assert.ok(title.right <= zone.right);
    assert.ok(credit.right <= zone.right);
    assert.ok(caption.bottom <= zone.bottom);
  });

  it("uses the center of the safe width, not the full frame, for centered text", () => {
    const zone = getSafeZone();
    const stacked = getTextPlacement({
      layout: {
        layout: "stacked-split",
        facecam: { x: 0, y: 0, width: 200, height: 200 },
      },
      source,
    });
    const blurred = getTextPlacement({
      layout: { layout: "blurred-background", hookTitle: "HOOK" },
    });
    assert.equal(stacked.caption.x, zone.width / 2);
    assert.notEqual(stacked.caption.x, FRAME_WIDTH / 2);
    assert.equal(blurred.caption.x, zone.width / 2);
    assert.ok(blurred.title);
    assert.equal(blurred.title.x, zone.width / 2);
  });
});

describe("gameplay crop", () => {
  it("applies a horizontal offset and clamps to the source", () => {
    const output = { width: 1080, height: 1248 };
    const centered = gameplayCenterCrop({ width: 1920, height: 1080 }, output, 0);
    const shifted = gameplayCenterCrop({ width: 1920, height: 1080 }, output, 400);
    const clamped = gameplayCenterCrop({ width: 1920, height: 1080 }, output, 10_000);
    assert.ok(shifted.x > centered.x);
    assert.equal(clamped.x + clamped.width, 1920);
    assert.equal(centered.y, 0);
    assert.equal(centered.height, 1080);
  });
});

describe("credit copy", () => {
  it("formats twitch.tv and @ handles without a leading @ on the login", () => {
    assert.equal(formatStreamerCredit({ login: "OhnePixel" }), "twitch.tv/OhnePixel");
    assert.equal(formatStreamerCredit({ login: "@OhnePixel", format: "at" }), "@OhnePixel");
    assert.equal(formatStreamerCredit({ login: "  name  " }), "twitch.tv/name");
    assert.equal(formatStreamerCredit({ login: "   " }), "");
  });
});
