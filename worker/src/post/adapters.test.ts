import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POST_ADAPTERS } from "./adapters";

describe("posting adapters", () => {
  it("exposes typed stubs for all four platforms and does not publish", async () => {
    const platforms = ["youtube", "tiktok", "instagram", "facebook"] as const;
    for (const platform of platforms) {
      const result = await POST_ADAPTERS[platform].publish({
        clipId: "clip-1",
        filePath: "/tmp/clip.mp4",
        title: "CLIP IT",
        hashtags: ["GTA6"],
      });
      assert.equal(result.status, "stub");
      assert.equal(result.platform, platform);
      assert.match(result.message, /not implemented/i);
    }
  });
});
