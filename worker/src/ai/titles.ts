export type Platform = "youtube" | "tiktok" | "instagram" | "facebook";

export type TitlePack = {
  platform: Platform;
  title: string;
  description: string;
  hashtags: string[];
};

/**
 * Ask a local LLM (Ollama-compatible) or a free-tier fallback for titles.
 * Results must remain editable in the Clip Queue. Default auto-post should
 * not publish unreviewed copy.
 */
export async function writeTitles(_input: {
  transcript: string;
  streamTitle: string;
  platforms: Platform[];
}): Promise<TitlePack[]> {
  throw new Error("Title generation is not implemented. See docs/PROJECT_PLAN.md Phase 4.");
}
