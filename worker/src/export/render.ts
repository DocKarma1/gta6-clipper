/**
 * Burn captions and write a 1080x1920 H.264/AAC MP4 with no watermark,
 * then upload to R2. Implementation lands in Phases 3–4.
 */
export async function renderShort(_input: {
  videoPath: string;
  transcriptPath: string;
  style: string;
  outputPath: string;
}): Promise<void> {
  throw new Error("Caption render is not implemented. See docs/PROJECT_PLAN.md Phase 4.");
}
