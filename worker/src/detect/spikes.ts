import { randomUUID } from "node:crypto";
import type { CandidateMoment, ChatEvent } from "@gta6-clipper/shared";

export const HYPE_KEYWORDS = [
  "clip it",
  "clipit",
  "clip that",
  "clipthat",
  "clutch",
  "lul",
  "lmao",
  "lol",
  "haha",
  "kekw",
  "kek",
  "omegalul",
  "pog",
  "pogchamp",
  "no way",
  "oh my god",
  "omg",
  "wtf",
] as const;

const FLOOD_EMOTES = new Set(["lul", "kekw", "omegalul", "kek", "pog", "w"]);
const SHORT_WINDOW_MS = 5_000;
const BASELINE_WINDOW_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MIN_SCORE = 55;

export type SpikeDetectorOptions = {
  cooldownMs?: number;
  minScore?: number;
};

type Bucket = { at: number; messages: number; unique: Set<string> };

export class ChannelSpikeDetector {
  private readonly buckets: Bucket[] = [];
  private lastEmitMs = 0;

  constructor(
    private readonly channelLogin: string,
    private readonly options: SpikeDetectorOptions = {},
  ) {}

  ingest(event: ChatEvent): CandidateMoment | null {
    const at = Date.parse(event.receivedAt);
    if (!Number.isFinite(at)) return null;
    this.add(event, at);
    this.prune(at);
    return this.evaluate(event, at);
  }

  private add(event: ChatEvent, at: number): void {
    const last = this.buckets.at(-1);
    if (!last || at - last.at >= 1_000) {
      this.buckets.push({ at, messages: 1, unique: new Set([event.userLogin]) });
      return;
    }
    last.messages += 1;
    last.unique.add(event.userLogin);
  }

  private prune(now: number): void {
    const cutoff = now - BASELINE_WINDOW_MS - SHORT_WINDOW_MS;
    while (this.buckets.length > 0 && (this.buckets[0]?.at ?? now) < cutoff) {
      this.buckets.shift();
    }
  }

  private evaluate(event: ChatEvent, at: number): CandidateMoment | null {
    const cooldown = this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    if (at - this.lastEmitMs < cooldown) return null;

    const short = this.buckets.filter((bucket) => at - bucket.at <= SHORT_WINDOW_MS);
    const baseline = this.buckets.filter(
      (bucket) =>
        at - bucket.at > SHORT_WINDOW_MS && at - bucket.at <= SHORT_WINDOW_MS + BASELINE_WINDOW_MS,
    );
    const shortMessages = short.reduce((sum, bucket) => sum + bucket.messages, 0);
    const shortSeconds = Math.max(SHORT_WINDOW_MS / 1000, 1);
    const rate = shortMessages / shortSeconds;
    const baselineRates = baseline.map((bucket) => bucket.messages); // per 1s buckets
    const mean =
      baselineRates.length > 0
        ? baselineRates.reduce((sum, value) => sum + value, 0) / baselineRates.length
        : 0;
    const variance =
      baselineRates.length > 1
        ? baselineRates.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          (baselineRates.length - 1)
        : 0;
    const std = Math.sqrt(variance);
    const zScore = std > 0.15 ? (rate - mean) / std : rate >= 4 && mean < 1 ? 3 : 0;

    const reasons: string[] = [];
    const lowered = event.text.toLowerCase();
    const keywordHits = HYPE_KEYWORDS.filter((keyword) => lowered.includes(keyword));
    if (keywordHits.length > 0) reasons.push(`keyword:${keywordHits[0]}`);

    const tokens = tokenize(event.text);
    const emoteHits = [...event.emoteTokens, ...tokens].filter((token) => FLOOD_EMOTES.has(token));
    const emoteOnly =
      tokens.length > 0 &&
      tokens.every((token) => FLOOD_EMOTES.has(token) || /^w+$/u.test(token) || token === "😭");
    if (emoteHits.length > 0 && (emoteOnly || shortMessages >= 8)) {
      reasons.push("emote-flood");
    }
    if (/\bclip(?:\s*it)?\b/i.test(event.text)) {
      if (!reasons.some((item) => item.startsWith("keyword:clip"))) reasons.push("keyword:clip it");
    }

    const unique = new Set(short.flatMap((bucket) => [...bucket.unique]));
    const uniqueRatio = shortMessages > 0 ? unique.size / shortMessages : 0;
    if (zScore >= 2.2) reasons.push("rate-spike");

    let score = 0;
    score += clampScore(zScore * 14);
    if (keywordHits.length > 0) score += 28;
    if (reasons.includes("emote-flood")) score += 18;
    if (uniqueRatio >= 0.5 && shortMessages >= 6) score += 12;
    if (uniqueRatio < 0.2 && shortMessages >= 8) score -= 8; // one user mashing
    score = Math.round(clampScore(score));

    const minScore = this.options.minScore ?? DEFAULT_MIN_SCORE;
    if (score < minScore || reasons.length === 0) return null;

    this.lastEmitMs = at;
    const startedAt = new Date(at - SHORT_WINDOW_MS).toISOString();
    return {
      id: randomUUID(),
      channelLogin: this.channelLogin,
      channelId: undefined,
      startedAt,
      peakAt: new Date(at).toISOString(),
      hypeScore: score,
      reasons,
      messageRate: Number(rate.toFixed(2)),
      baselineRate: Number(mean.toFixed(2)),
      zScore: Number(zScore.toFixed(2)),
    };
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/u)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}
