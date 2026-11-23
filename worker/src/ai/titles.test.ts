import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTemplatePacks, templateHookTitle } from "./titles";

describe("template titles", () => {
  it("uses CLIP IT or CHAT LOST IT from moment reasons", () => {
    assert.equal(
      templateHookTitle({ transcript: "", streamTitle: "", reasons: ["clip-it"] }),
      "CLIP IT",
    );
    assert.equal(
      templateHookTitle({ transcript: "", streamTitle: "", reasons: ["emote-flood"] }),
      "CHAT LOST IT",
    );
  });

  it("falls back to the first transcript sentence and includes hashtags", () => {
    const packs = buildTemplatePacks({
      planId: "starter",
      transcript: "He just jumped the bridge. Unreal.",
      streamTitle: "GTA 6 first drive",
      channelLogin: "ohnepixel",
      reasons: ["z-score"],
    });
    assert.equal(packs[0]?.title, "He just jumped the bridge");
    assert.ok(packs[0]?.hashtags.includes("GTA6"));
    assert.ok(packs[0]?.hashtags.includes("ohnepixel"));
    assert.equal(packs[0]?.source, "template");
    assert.equal(packs.length, 4);
  });
});
