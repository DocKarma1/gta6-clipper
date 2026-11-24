import { z } from "zod";
import { canUseAiTitles, getLogger, getOllamaSettings, type PlanId } from "@gta6-clipper/shared";
import { OllamaClient } from "./ollama";

export type Platform = "youtube" | "tiktok" | "instagram" | "facebook";
export type CopyLanguage = "en" | "sv";

export type TitlePack = {
  platform: Platform;
  title: string;
  description: string;
  hashtags: string[];
  /** Short all-caps overlay text for the blurred-background layout. */
  hookText: string;
  source: "llm" | "template";
};

export type TitleInput = {
  planId: PlanId;
  transcript: string;
  streamTitle: string;
  channelLogin: string;
  reasons: string[];
  platforms?: Platform[];
  language?: CopyLanguage;
  /** question_reply clips: the question the streamer asked. */
  questionText?: string;
  /** Trend layer: search phrases this clip matched (e.g. "gta 6 police chase"). */
  trendTopics?: string[];
};

const log = getLogger("worker.titles");

const DEFAULT_HASHTAGS = ["GTA6", "GTAVI", "Twitch", "clip", "fyp"];
const ALL_PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram", "facebook"];

/** Per-platform title limits (characters). */
const TITLE_LIMIT: Record<Platform, number> = {
  youtube: 90,
  tiktok: 100,
  instagram: 100,
  facebook: 100,
};

const TEMPLATE_TEXT = {
  en: {
    clip: "CLIP IT",
    flood: "CHAT LOST IT",
    question: "CHAT ANSWERED",
    play: "WHAT A PLAY",
    description: (login: string) => `A live GTA 6 moment from ${login} on Twitch.`,
  },
  sv: {
    clip: "KLIPP DET",
    flood: "CHATTEN TAPPADE DET",
    question: "CHATTEN SVARADE",
    play: "VILKET DRAG",
    description: (login: string) => `Ett live-ögonblick i GTA 6 från ${login} på Twitch.`,
  },
} as const;

export function templateHookTitle(
  input: Pick<TitleInput, "transcript" | "streamTitle" | "reasons" | "language">,
): string {
  const text = TEMPLATE_TEXT[input.language ?? "en"];
  if (input.reasons.includes("question-reply")) return text.question;
  if (input.reasons.some((reason) => /clip/i.test(reason))) return text.clip;
  if (input.reasons.includes("emote-flood")) return text.flood;
  const spoken = firstSentence(input.transcript);
  if (spoken) return spoken;
  const stream = input.streamTitle.trim();
  if (stream) return truncate(stream, 48);
  return text.play;
}

export function templateHashtags(channelLogin: string): string[] {
  const channel = channelLogin.replace(/[^a-zA-Z0-9_]/g, "");
  const tags = [...DEFAULT_HASHTAGS];
  if (channel) tags.splice(2, 0, channel);
  return unique(tags).slice(0, 8);
}

export function buildTemplatePacks(input: TitleInput): TitlePack[] {
  const language = input.language ?? "en";
  const title = templateHookTitle({ ...input, language });
  const hashtags = templateHashtags(input.channelLogin);
  const description = input.transcript
    ? truncate(input.transcript, 180)
    : TEMPLATE_TEXT[language].description(input.channelLogin);
  const hookText = truncate(title.toUpperCase(), 32);
  return (input.platforms ?? ALL_PLATFORMS).map((platform) => ({
    platform,
    title: truncate(title, TITLE_LIMIT[platform]),
    description,
    hashtags,
    hookText,
    source: "template" as const,
  }));
}

const clipCopySchema = z.object({
  hook: z.string().trim().min(2).max(60),
  title: z.string().trim().min(4).max(120),
  description: z.string().trim().min(4).max(400),
  hashtags: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
});
export type ClipCopy = z.infer<typeof clipCopySchema>;

export function buildCopyPrompt(input: TitleInput): { system: string; prompt: string } {
  const language = input.language ?? "en";
  const languageName = language === "sv" ? "Swedish" : "English";
  return {
    system: [
      "You write short-form video copy for GTA 6 Twitch clips (YouTube Shorts, TikTok, Reels).",
      `Write in ${languageName}. Be punchy and accurate; never invent events that are not in the transcript or chat reasons.`,
      "No slurs, no clickbait lies, no emojis in the hook. Credit the streamer by name in the description.",
      'Answer with JSON only: {"hook":"...","title":"...","description":"...","hashtags":["..."]}.',
      "hook: max 32 characters, ALL CAPS, for an on-screen overlay.",
      "title: max 90 characters. description: 1-2 sentences, max 300 characters, with the transcript's key line cleaned up (fix punctuation and casing).",
      "hashtags: 4-8 tags without #, always include GTA6.",
      ...(input.trendTopics?.length
        ? [
            "If a searchable topic fits what actually happens, reuse its wording in the title or hashtags so viewers searching for it find the clip. Ignore topics that do not fit; never add events for them.",
          ]
        : []),
    ].join("\n"),
    prompt: [
      `Streamer: ${input.channelLogin} (twitch.tv/${input.channelLogin})`,
      `Stream title: ${truncate(input.streamTitle || "unknown", 140)}`,
      `Why chat reacted: ${input.reasons.join(", ") || "hype"}`,
      ...(input.questionText
        ? [`The streamer asked chat: ${truncate(input.questionText, 160)}`]
        : []),
      `Transcript: ${truncate(input.transcript || "none", 700)}`,
      ...(input.trendTopics?.length
        ? [`Searchable topics: ${input.trendTopics.slice(0, 4).join(", ")}`]
        : []),
    ].join("\n"),
  };
}

/** Turn validated model copy into per-platform packs, merged with template tags. */
export function packsFromCopy(copy: ClipCopy, input: TitleInput): TitlePack[] {
  const hashtags = unique([
    ...copy.hashtags.map((tag) => tag.replace(/^#+/u, "").replace(/\s+/gu, "")).filter(Boolean),
    ...templateHashtags(input.channelLogin),
  ]).slice(0, 8);
  const hookText = truncate(copy.hook.toUpperCase(), 32);
  return (input.platforms ?? ALL_PLATFORMS).map((platform) => ({
    platform,
    title: truncate(copy.title, TITLE_LIMIT[platform]),
    description: truncate(copy.description, 300),
    hashtags,
    hookText,
    source: "llm" as const,
  }));
}

let sharedClient: OllamaClient | undefined;

function defaultClient(): OllamaClient {
  if (!sharedClient) {
    const settings = getOllamaSettings();
    sharedClient = new OllamaClient({
      baseUrl: settings.url,
      model: settings.model,
      timeoutMs: settings.timeoutMs,
      retries: 1,
    });
  }
  return sharedClient;
}

/**
 * Titles, descriptions, hashtags, and hook text for a clip. Uses local
 * Ollama when the plan includes AI titles and the server answers with valid
 * JSON; otherwise the template copy. Never throws.
 */
export async function writeTitles(
  input: TitleInput,
  client: OllamaClient | undefined = undefined,
): Promise<TitlePack[]> {
  const language = input.language ?? getOllamaSettings().language;
  const withLanguage = { ...input, language };
  const templates = buildTemplatePacks(withLanguage);
  if (!canUseAiTitles(input.planId)) return templates;
  const ollama = client ?? defaultClient();
  const { system, prompt } = buildCopyPrompt(withLanguage);
  const copy = await ollama.generateJson(clipCopySchema, { system, prompt });
  if (!copy) return templates;
  log.info({ model: ollama.model }, "Used local Ollama for clip copy");
  return packsFromCopy(copy, withLanguage);
}

function firstSentence(text: string): string | undefined {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length < 8) return undefined;
  const sentence = cleaned.split(/[.!?]/)[0] ?? cleaned;
  return truncate(sentence, 48);
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
