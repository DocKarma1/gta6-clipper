/**
 * Reframe a 16:9 (or other) source to 1080x1920.
 * v1: static / layout-preset crop. Later: motion-following crop on CPU.
 */
export type ReframeMode = "gameplay-center" | "facecam-top" | "follow-action";

export async function reframeToVertical(
  _inputPath: string,
  _outputPath: string,
  _mode: ReframeMode = "gameplay-center"
): Promise<void> {
  throw new Error("9:16 reframe is not implemented. See docs/PROJECT_PLAN.md Phases 3 and 5.");
}
