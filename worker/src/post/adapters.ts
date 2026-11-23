export type PostPlatform = "youtube" | "tiktok" | "instagram" | "facebook";

export type PostRequest = {
  clipId: string;
  filePath: string;
  title: string;
  hashtags: string[];
  accountRef?: string;
};

export type PostResult = {
  status: "stub";
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

  async publish(_request: PostRequest): Promise<PostResult> {
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
