import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FRAME_HEIGHT, FRAME_WIDTH, getStackedSplitGeometry } from "@gta6-clipper/shared";
import {
  buildRenderArgs,
  buildVerticalLayoutFilter,
  cropFilter,
  escapeFfmpegFilterPath,
  quoteFfmpegFilterPath,
} from "./layouts";

const source = { width: 1920, height: 1080 };
const facecam = { x: 1480, y: 40, width: 400, height: 300 };

describe("buildVerticalLayoutFilter", () => {
  it("builds a stacked-split graph at 1080x1920 with facecam crop and vstack", () => {
    const graph = buildVerticalLayoutFilter({
      layout: { layout: "stacked-split", facecam },
      source,
    });
    const geometry = getStackedSplitGeometry({ layout: "stacked-split", facecam }, source);
    assert.equal(graph.videoWidth, FRAME_WIDTH);
    assert.equal(graph.videoHeight, FRAME_HEIGHT);
    assert.equal(graph.outputLabel, "vout");
    assert.match(graph.filterComplex, /split=2/);
    assert.match(graph.filterComplex, /vstack=inputs=2/);
    assert.match(
      graph.filterComplex,
      new RegExp(cropFilter(geometry.facecamCrop).replaceAll(":", "\\:")),
    );
    assert.match(
      graph.filterComplex,
      new RegExp(cropFilter(geometry.gameplayCrop).replaceAll(":", "\\:")),
    );
    assert.match(
      graph.filterComplex,
      new RegExp(`scale=${FRAME_WIDTH}:${geometry.facecamBandHeight}`),
    );
    assert.match(
      graph.filterComplex,
      new RegExp(`scale=${FRAME_WIDTH}:${geometry.gameplayHeight}`),
    );
    assert.equal(geometry.facecamBandHeight, 672);
    assert.equal(geometry.gameplayHeight, 1248);
    assert.match(graph.filterComplex, /format=yuv420p\[vout\]/);
  });

  it("shifts the gameplay crop when a horizontal offset is set", () => {
    const centered = buildVerticalLayoutFilter({
      layout: { layout: "stacked-split", facecam },
      source,
    });
    const shifted = buildVerticalLayoutFilter({
      layout: { layout: "stacked-split", facecam, gameplayXOffset: 400 },
      source,
    });
    const left = getStackedSplitGeometry({ layout: "stacked-split", facecam }, source).gameplayCrop;
    const right = getStackedSplitGeometry(
      { layout: "stacked-split", facecam, gameplayXOffset: 400 },
      source,
    ).gameplayCrop;
    assert.ok(right.x > left.x);
    assert.ok(shifted.filterComplex.includes(cropFilter(right)));
    assert.ok(!shifted.filterComplex.includes(cropFilter(left)));
    assert.notEqual(centered.filterComplex, shifted.filterComplex);
  });

  it("builds a blurred-background graph with cover-scale, gblur, optional darken, and centered overlay", () => {
    const graph = buildVerticalLayoutFilter({
      layout: { layout: "blurred-background", hookTitle: "HE DID WHAT?" },
      source,
    });
    assert.match(graph.filterComplex, /scale=1080:1920:force_original_aspect_ratio=increase/);
    assert.match(graph.filterComplex, /gblur=sigma=20/);
    assert.match(graph.filterComplex, /eq=brightness=-0\.3/);
    assert.match(graph.filterComplex, /overlay=\(W-w\)\/2:/);
    assert.match(graph.filterComplex, /format=yuv420p\[vout\]/);
  });

  it("omits the darken filter when backgroundDarken is 0", () => {
    const graph = buildVerticalLayoutFilter({
      layout: { layout: "blurred-background", hookTitle: "HOOK", backgroundDarken: 0 },
      source,
    });
    assert.ok(!graph.filterComplex.includes("eq=brightness"));
  });

  it("rejects an invalid facecam or blur setting", () => {
    assert.throws(
      () =>
        buildVerticalLayoutFilter({
          layout: { layout: "stacked-split", facecam: { x: 0, y: 0, width: 0, height: 10 } },
          source,
        }),
      /facecam/,
    );
    assert.throws(
      () =>
        buildVerticalLayoutFilter({
          layout: { layout: "blurred-background", hookTitle: "X", blurSigma: -1 },
          source,
        }),
      /blurSigma/,
    );
  });
});

describe("buildRenderArgs", () => {
  it("returns argv that maps the layout output and can burn an escaped ASS path", () => {
    const graph = buildVerticalLayoutFilter({
      layout: { layout: "blurred-background", hookTitle: "HOOK" },
      source,
    });
    const args = buildRenderArgs({
      inputPath: "/tmp/in.mp4",
      outputPath: "/tmp/out.mp4",
      filterComplex: graph.filterComplex,
      outputLabel: graph.outputLabel,
      assPath: "/tmp/clips/title: take 1.ass",
      fontsDir: "/usr/share/fonts/truetype/dejavu",
      includeAudio: false,
    });
    const complex = args[args.indexOf("-filter_complex") + 1];
    assert.ok(complex?.includes("ass=filename="));
    assert.ok(complex?.includes("title\\: take 1.ass"));
    assert.ok(args.includes("-an"));
    assert.ok(args.includes("[vsub]"));
    assert.equal(args.at(-1), "/tmp/out.mp4");
  });
});

describe("escapeFfmpegFilterPath", () => {
  it("escapes characters that would break a filter argument", () => {
    assert.equal(escapeFfmpegFilterPath("/tmp/title: take 1.ass"), "/tmp/title\\: take 1.ass");
  });
});

describe("quoteFfmpegFilterPath", () => {
  it("quotes Windows drive paths with forward slashes and an escaped colon", () => {
    assert.equal(
      quoteFfmpegFilterPath("C:\\Users\\Karma\\AppData\\Local\\Temp\\clipper-ass-1\\captions.ass"),
      "'C\\:/Users/Karma/AppData/Local/Temp/clipper-ass-1/captions.ass'",
    );
  });
  it("quotes POSIX paths and escapes colons", () => {
    if (process.platform === "win32") return;
    assert.equal(quoteFfmpegFilterPath("/tmp/a: b [1].ass"), "'/tmp/a\\: b [1].ass'");
  });
});
