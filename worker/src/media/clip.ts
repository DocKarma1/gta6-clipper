/**
 * Cut a bounded window around a spike using ffmpeg + streamlink or yt-dlp.
 * Runs on the always-on VPS only — never on Vercel serverless.
 */
export type ClipJob = {
  source: "twitch-live" | "youtube-vod";
  sourceUrl: string;
  startSeconds: number;
  durationSeconds: number;
  outputPath: string;
};

export async function cutClip(_job: ClipJob): Promise<void> {
  throw new Error("ffmpeg clipping is not implemented. See docs/PROJECT_PLAN.md Phase 3.");
}
