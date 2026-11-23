import { canUseAiTitles, getConfig, getLogger, type PlanId } from "@gta6-clipper/shared";

export type Platform = "youtube" | "tiktok" | "instagram" | "facebook";

export type TitlePack = {
  platform: Platform;
  title: string;
  description: string;
  hashtags: string[];
  source: "llm" | "template";
};

export type TitleInput = {
  planId: PlanId;
  transcript: string;
  streamTitle: string;
  channelLogin: string;
  reasons: string[];
  platforms?: Platform[];
};

const log = getLogger("worker.titles");

let llmAvailable: boolean | undefined;

const DEFAULT_HASHTAGS = ["GTA6", "GTAVI", "Twitch", "clip", "fyp"];

export function templateHookTitle(
  input: Pick<TitleInput, "transcript" | "streamTitle" | "reasons">,
): string {
  if (input.reasons.some((reason) => /clip/i.test(reason))) return "CLIP IT";
  if (input.reasons.includes("emote-flood")) return "CHAT LOST IT";
  const spoken = firstSentence(input.transcript);
  if (spoken) return spoken;
  const stream = input.streamTitle.trim();
  if (stream) return truncate(stream, 48);
  return "WHAT A PLAY";
}

export function templateHashtags(channelLogin: string): string[] {
  const channel = channelLogin.replace(/[^a-zA-Z0-9_]/g, "");
  const tags = [...DEFAULT_HASHTAGS];
  if (channel) tags.splice(2, 0, channel);
  return unique(tags).slice(0, 8);
}

export function buildTemplatePacks(input: TitleInput): TitlePack[] {
  const title = templateHookTitle(input);
  const hashtags = templateHashtags(input.channelLogin);
  const platforms =
    input.platforms ?? (["youtube", "tiktok", "instagram", "facebook"] satisfies Platform[]);
  const description = input.transcript
    ? truncate(input.transcript, 180)
    : `A live GTA 6 moment from ${input.channelLogin} on Twitch.`;
  return platforms.map((platform) => ({
    platform,
    title,
    description,
    hashtags,
    source: "template" as const,
  }));
}

export async function writeTitles(input: TitleInput): Promise<TitlePack[]> {
  const templates = buildTemplatePacks(input);
  if (!canUseAiTitles(input.planId)) {
    return templates;
  }
  const generated = await tryLocalLlm(input, templates);
  return generated ?? templates;
}

async function tryLocalLlm(
  input: TitleInput,
  fallback: TitlePack[],
): Promise<TitlePack[] | undefined> {
  const config = getConfig();
  const baseUrl = config.LLM_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) return undefined;
  if (llmAvailable === false) return undefined;
  if (llmAvailable === undefined) {
    try {
      const probe = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(400) });
      llmAvailable = probe.ok;
    } catch {
      llmAvailable = false;
    }
    if (!llmAvailable) {
      log.info("No local LLM was available; using template titles and hashtags");
      return undefined;
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.LLM_MODEL,
        stream: false,
        prompt: [
          "Write one short all-caps hook title (max 48 characters) and 5 hashtags for a GTA 6 Twitch clip.",
          'Return JSON only: {"title":"...","hashtags":["..."]}.',
          `Channel: ${input.channelLogin}`,
          `Stream title: ${input.streamTitle}`,
          `Chat reasons: ${input.reasons.join(", ") || "hype"}`,
          `Transcript: ${truncate(input.transcript || "none", 400)}`,
        ].join("\n"),
      }),
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { response?: string };
    const parsed = extractJson(payload.response ?? "");
    if (!parsed?.title) return undefined;
    const hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((tag) => String(tag).replace(/^#/, "")).filter(Boolean)
      : templateHashtags(input.channelLogin);
    log.info("Used a local LLM for clip titles");
    return fallback.map((pack) => ({
      ...pack,
      title: truncate(String(parsed.title), 48),
      hashtags: unique([...hashtags, ...pack.hashtags]).slice(0, 8),
      source: "llm",
    }));
  } catch {
    log.info("No local LLM was available; using template titles and hashtags");
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text: string): { title?: string; hashtags?: unknown } | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as { title?: string; hashtags?: unknown };
  } catch {
    return undefined;
  }
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
