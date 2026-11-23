import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlanLimitError } from "./errors";
import {
  assertAiTitles,
  assertCaptionStyle,
  assertClipsThisMonth,
  assertConcurrentStreams,
  capConcurrentStreams,
  evaluatePlanGate,
} from "./plan-gates";
import { CAPTION_STYLE_IDS, getPlan, PLANS } from "./plans";

describe("plan catalog", () => {
  it("defines Starter, Pro, and Studio with the published limits", () => {
    assert.deepEqual(
      PLANS.map((plan) => plan.id),
      ["starter", "pro", "studio"],
    );
    assert.equal(getPlan("starter").streamsAtOnce, 2);
    assert.equal(getPlan("starter").clipsPerMonth, 200);
    assert.equal(getPlan("starter").captionStyles, 4);
    assert.equal(getPlan("starter").aiTitles, false);
    assert.equal(getPlan("pro").streamsAtOnce, 5);
    assert.equal(getPlan("pro").clipsPerMonth, 600);
    assert.equal(getPlan("pro").aiTitles, true);
    assert.equal(getPlan("studio").streamsAtOnce, 10);
    assert.equal(getPlan("studio").clipsPerMonth, 2000);
    assert.equal(getPlan("studio").captionStyles, 8);
  });
});

describe("plan gates", () => {
  it("allows up to the concurrent stream cap and rejects above it", () => {
    assertConcurrentStreams("starter", 2);
    assert.throws(() => assertConcurrentStreams("starter", 3), PlanLimitError);
    assert.deepEqual(capConcurrentStreams("starter", [1, 2, 3, 4]), [1, 2]);
    assertConcurrentStreams("studio", 10);
    assert.throws(() => assertConcurrentStreams("studio", 11), PlanLimitError);
  });

  it("enforces the monthly clip cap", () => {
    assertClipsThisMonth("starter", 199);
    assert.throws(() => assertClipsThisMonth("starter", 200), PlanLimitError);
    assertClipsThisMonth("pro", 599);
    assert.throws(() => assertClipsThisMonth("pro", 600), PlanLimitError);
  });

  it("restricts caption styles to the plan's allotment", () => {
    assertCaptionStyle("starter", "default");
    assertCaptionStyle("starter", "boxed");
    assert.throws(() => assertCaptionStyle("starter", "karaoke"), PlanLimitError);
    assertCaptionStyle("pro", "impact");
    assert.equal(CAPTION_STYLE_IDS.length, 8);
  });

  it("blocks AI titles on Starter and allows them on Pro and Studio", () => {
    assert.throws(() => assertAiTitles("starter"), PlanLimitError);
    assertAiTitles("pro");
    assertAiTitles("studio");
  });

  it("returns a structured evaluation used by the API and worker", () => {
    const ok = evaluatePlanGate("pro", "clip", { clipsThisMonth: 10 });
    assert.equal(ok.allowed, true);
    const blocked = evaluatePlanGate("starter", "ai_titles", {});
    assert.equal(blocked.allowed, false);
    if (!blocked.allowed) {
      assert.equal(blocked.error.limit, "aiTitles");
    }
  });
});
