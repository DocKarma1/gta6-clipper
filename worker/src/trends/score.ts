import { z } from "zod";
import { getLogger, type TrendSettings } from "@gta6-clipper/shared";
import type { OllamaClient } from "../ai/ollama";
import { textTokens, type TrendTopic } from "./normalize";

const log = getLogger("worker.trends");

export type TrendMatch = {
  label: string;
  tokens: string[];
  topicWeight: number;
  /** 1 = every token said in the transcript; lower when chat reasons or Ollama filled in. */
  confidence: number;
  via: "transcript" | "chat" | "ollama";
};

export type TrendEvaluation = {
  reactionScore: number;
  /** 0-100. */
  trendScore: number;
  /** reaction + weight x trend (can exceed 100; not clamped so ordering stays honest). */
  combinedScore: number;
  boost: number;
  matches: TrendMatch[];
  decision: "keep" | "skip";
  skipReason?: string;
};

/**
 * What a chat reason implies about the moment. Weak hints only: an emote
 * flood is usually something funny, hype keywords something wild.
 */
const REASON_HINTS: Record<string, readonly string[]> = {
  "emote-flood": ["funny"],
  "keyword:hype": ["insane"],
};

const CHAT_CONFIDENCE = 0.5;
const OLLAMA_CONFIDENCE = 0.7;

export function reasonTokens(reasons: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const reason of reasons) {
    for (const token of REASON_HINTS[reason] ?? []) out.add(token);
  }
  return out;
}

/**
 * Local keyword/phrase matching: a topic matches when all of its canonical
 * tokens appear in the transcript (synonyms folded), or in the transcript
 * plus chat-reason hints (half confidence).
 */
export function matchTrends(
  input: { transcript: string; reasons: readonly string[] },
  topics: readonly TrendTopic[],
): TrendMatch[] {
  const spoken = textTokens(input.transcript);
  const hinted = reasonTokens(input.reasons);
  const matches: TrendMatch[] = [];
  for (const topic of topics) {
    let fromChat = false;
    let covered = true;
    for (const token of topic.tokens) {
      if (spoken.has(token)) continue;
      if (hinted.has(token)) {
        fromChat = true;
        continue;
      }
      covered = false;
      break;
    }
    if (!covered) continue;
    matches.push({
      label: topic.label,
      tokens: topic.tokens,
      topicWeight: topic.weight,
      confidence: fromChat ? CHAT_CONFIDENCE : 1,
      via: fromChat ? "chat" : "transcript",
    });
  }
  return rankMatches(matches);
}

/** Specific multi-word topics beat single generic words. */
function matchStrength(match: TrendMatch): number {
  const specificity = match.tokens.length >= 2 ? 1 : 0.8;
  return match.topicWeight * match.confidence * specificity;
}

function rankMatches(matches: TrendMatch[]): TrendMatch[] {
  return matches.sort(
    (a, b) => matchStrength(b) - matchStrength(a) || a.label.localeCompare(b.label),
  );
}

/** Best match counts fully, the next two add diminishing extra. 0-100. */
export function trendScoreFromMatches(matches: readonly TrendMatch[]): number {
  const strengths = matches.map(matchStrength).sort((a, b) => b - a);
  const raw = (strengths[0] ?? 0) + 0.3 * (strengths[1] ?? 0) + 0.15 * (strengths[2] ?? 0);
  return Math.round(100 * Math.min(1, raw));
}

/**
 * Reaction stays primary: combined = reaction + weight x trend, so a clip
 * with no trend match keeps its reaction score. Clips are only skipped when
 * TREND_MIN_SCORE or TREND_MIN_COMBINED_SCORE is set.
 */
export function evaluateTrends(
  input: { reactionScore: number; matches: TrendMatch[] },
  settings: Pick<TrendSettings, "weight" | "minScore" | "minCombinedScore">,
): TrendEvaluation {
  const trendScore = trendScoreFromMatches(input.matches);
  const boost = Number((settings.weight * trendScore).toFixed(1));
  const combinedScore = Number((input.reactionScore + boost).toFixed(1));
  const base = {
    reactionScore: input.reactionScore,
    trendScore,
    combinedScore,
    boost,
    matches: input.matches,
  };
  if (settings.minScore !== undefined && trendScore < settings.minScore) {
    return {
      ...base,
      decision: "skip",
      skipReason: `trend score ${trendScore} < TREND_MIN_SCORE ${settings.minScore}`,
    };
  }
  if (settings.minCombinedScore !== undefined && combinedScore < settings.minCombinedScore) {
    return {
      ...base,
      decision: "skip",
      skipReason: `combined score ${combinedScore} < TREND_MIN_COMBINED_SCORE ${settings.minCombinedScore}`,
    };
  }
  return { ...base, decision: "keep" };
}

/** Up to `max` search phrases for the title prompt, strongest first. */
export function searchableTopics(matches: readonly TrendMatch[], max = 4): string[] {
  return matches.slice(0, max).map((match) => match.label);
}

const tagSchema = z.object({ topics: z.array(z.string().trim().min(1).max(80)).max(8) });

/**
 * Optional: let Ollama pick which candidate topics the transcript clearly
 * shows (catches phrasing the keyword list misses). Only labels from the
 * candidate list are accepted. Returns [] when Ollama is down or slow.
 */
export async function tagTopicsWithOllama(
  client: OllamaClient,
  input: { transcript: string; reasons: readonly string[] },
  topics: readonly TrendTopic[],
  alreadyMatched: ReadonlySet<string>,
): Promise<TrendMatch[]> {
  const transcript = input.transcript.trim();
  if (transcript.length < 12) return [];
  const candidates = topics.filter((topic) => !alreadyMatched.has(topic.label)).slice(0, 40);
  if (candidates.length === 0) return [];
  const result = await client.generateJson(tagSchema, {
    temperature: 0,
    system: [
      "You tag GTA 6 Twitch clip transcripts with search topics.",
      "Pick only topics the transcript clearly shows happening. If none fit, return an empty list.",
      'Answer with JSON only: {"topics":["..."]} using labels copied exactly from the list.',
    ].join("\n"),
    prompt: [
      `Topics: ${candidates.map((topic) => topic.label).join(" | ")}`,
      `Why chat reacted: ${input.reasons.join(", ") || "hype"}`,
      `Transcript: ${transcript.slice(0, 700)}`,
    ].join("\n"),
  });
  if (!result) return [];
  const byLabel = new Map(candidates.map((topic) => [topic.label, topic]));
  const matches: TrendMatch[] = [];
  for (const raw of result.topics) {
    const topic = byLabel.get(raw.toLowerCase().trim());
    if (!topic) continue;
    matches.push({
      label: topic.label,
      tokens: topic.tokens,
      topicWeight: topic.weight,
      confidence: OLLAMA_CONFIDENCE,
      via: "ollama",
    });
  }
  if (matches.length) log.debug({ topics: matches.map((m) => m.label) }, "Ollama trend tags");
  return matches;
}

export type ScoreClipInput = {
  transcript: string;
  reasons: readonly string[];
  reactionScore: number;
};

/** Full pass used by the clip job. Never throws. */
export async function scoreClipTrends(
  input: ScoreClipInput,
  deps: {
    topics: readonly TrendTopic[];
    settings: Pick<TrendSettings, "weight" | "minScore" | "minCombinedScore">;
    ollama?: OllamaClient | undefined;
  },
): Promise<TrendEvaluation> {
  let matches: TrendMatch[] = [];
  try {
    matches = matchTrends(input, deps.topics);
    if (deps.ollama) {
      const tagged = await tagTopicsWithOllama(
        deps.ollama,
        input,
        deps.topics,
        new Set(matches.map((match) => match.label)),
      );
      matches = rankMatches([...matches, ...tagged]);
    }
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : "unknown" },
      "Trend matching failed; scoring on reaction only",
    );
    matches = [];
  }
  return evaluateTrends({ reactionScore: input.reactionScore, matches }, deps.settings);
}
