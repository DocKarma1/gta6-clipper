import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClipQaSummary } from "@gta6-clipper/shared";
import { POST_ADAPTERS, publishClip, type PostAdapter, type PostPlatform } from "./adapters";

const passedQa: ClipQaSummary = {
  version: 1,
  enabled: true,
  passed: true,
  checkedAt: "2026-11-24T00:00:00.000Z",
  checks: [],
  failed: [],
};

const request = {
  clipId: "clip-1",
  filePath: "/tmp/clip.mp4",
  title: "CLIP IT",
  hashtags: ["GTA6"],
};

describe("posting adapters", () => {
  it("exposes typed stubs for all four platforms and does not publish", async () => {
    const platforms = ["youtube", "tiktok", "instagram", "facebook"] as const;
    for (const platform of platforms) {
      const result = await POST_ADAPTERS[platform].publish({
        ...request,
        clip: { status: "ready", qa: passedQa },
      });
      assert.equal(result.status, "stub");
      assert.equal(result.platform, platform);
      assert.match(result.message, /not implemented/i);
    }
  });

  it("refuses clips that are not ready or have not passed QA", async () => {
    const cases = [
      { status: "review" as const, qa: { ...passedQa, passed: false, failed: ["title" as const] } },
      { status: "ready" as const },
      { status: "ready" as const, qa: { ...passedQa, enabled: false, passed: false } },
      { status: "ready" as const, qa: { ...passedQa, passed: false, failed: ["format" as const] } },
      { status: "failed" as const, qa: passedQa },
    ];
    for (const clip of cases) {
      const result = await POST_ADAPTERS.tiktok.publish({ ...request, clip });
      assert.equal(result.status, "blocked", JSON.stringify(clip));
    }
  });

  it("publishClip runs the guard before any adapter is called", async () => {
    let called = 0;
    const spy: PostAdapter = {
      platform: "youtube",
      async publish() {
        called += 1;
        return { status: "stub", platform: "youtube", message: "spy" };
      },
    };
    const adapters = { ...POST_ADAPTERS, youtube: spy } as Record<PostPlatform, PostAdapter>;
    const blocked = await publishClip(
      "youtube",
      { ...request, clip: { status: "review" } },
      adapters,
    );
    assert.equal(blocked.status, "blocked");
    assert.equal(called, 0);
    const ok = await publishClip(
      "youtube",
      { ...request, clip: { status: "ready", qa: passedQa } },
      adapters,
    );
    assert.equal(ok.status, "stub");
    assert.equal(called, 1);
  });
});
