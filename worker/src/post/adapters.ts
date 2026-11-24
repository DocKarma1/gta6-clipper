import type { ClipQaSummary, ClipStatus } from "@gta6-clipper/shared";
import { publishBlockReason } from "../qa/publish-guard";

export type PostPlatform = "youtube" | "tiktok" | "instagram" | "facebook";

export type PostRequest = {
  clipId: string;
  filePath: string;
  title: string;
  hashtags: string[];
  accountRef?: string;
  /** The clip's status and QA result; publishing is refused unless it is "ready" and passed QA. */
  clip: { status: ClipStatus; qa?: ClipQaSummary | undefined };
};

export type PostResult = {
  /** "blocked": refused by the QA publish guard before any platform call. */
  status: "stub" | "blocked";
  platform: PostPlatform;
  message: string;
};

export interface PostAdapter {
  readonly platform: PostPlatform;
  publish(request: PostRequest): Promise<PostResult>;
}

const STUB_MESSAGE =
  "Live auto-posting is not implemented. Destination API approvals and keys are not requested or used.";

class StubAdapter implements PostAdapter {
  constructor(readonly platform: PostPlatform) {}

  async publish(request: PostRequest): Promise<PostResult> {
    const blocked = publishBlockReason(request.clip);
    if (blocked) return { status: "blocked", platform: this.platform, message: blocked };
    return { status: "stub", platform: this.platform, message: STUB_MESSAGE };
  }
}

export const youtubeAdapter: PostAdapter = new StubAdapter("youtube");
export const tiktokAdapter: PostAdapter = new StubAdapter("tiktok");
export const instagramAdapter: PostAdapter = new StubAdapter("instagram");
export const facebookAdapter: PostAdapter = new StubAdapter("facebook");

export const POST_ADAPTERS: Record<PostPlatform, PostAdapter> = {
  youtube: youtubeAdapter,
  tiktok: tiktokAdapter,
  instagram: instagramAdapter,
  facebook: facebookAdapter,
};

/**
 * The one entry point for posting. Real adapters added later must be called
 * through this, so the QA publish guard runs before any platform request.
 */
export async function publishClip(
  platform: PostPlatform,
  request: PostRequest,
  adapters: Record<PostPlatform, PostAdapter> = POST_ADAPTERS,
): Promise<PostResult> {
  const blocked = publishBlockReason(request.clip);
  if (blocked) return { status: "blocked", platform, message: blocked };
  return adapters[platform].publish(request);
}
