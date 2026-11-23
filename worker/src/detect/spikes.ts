import { randomUUID } from "node:crypto";
import type { CandidateMoment, ChatEvent } from "@gta6-clipper/shared";
import { findOnsetSecond, findPeakSecond, smoothBins, type RateBin } from "./highlight";

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

const FLOOD_EMOTES = new Set([
  "lul",
  "kekw",
  "omegalul",
  "kek",
  "pog",
  "pogchamp",
  "w",
  "😭",
  "💀",
]);

/** Short window used to decide that a burst started. */
const SHORT_SECONDS = 5;
/** Baseline window before the short window. */
const BASELINE_SECONDS = 60;
/** A burst is over when chat stays below half its peak for this long... */
const SETTLE_QUIET_SECONDS = 3;
/** ...or at the latest this long after the trigger. */
const MAX_BURST_SECONDS = 15;
const DEFAULT_COOLDOWN_MS = 45_000;
const DEFAULT_MIN_SCORE = 55;
const DEFAULT_MIN_MESSAGES = 6;
const DEFAULT_MIN_USERS = 4;

export type SpikeDetectorOptions = {
  cooldownMs?: number;
  minScore?: number;
  /** Minimum messages in the 5 s trigger window. */
  minMessages?: number;
  /** Minimum distinct chatters in the 5 s trigger window. */
  minUsers?: number;
};

type Bin = {
  messages: number;
  users: Map<string, number>;
  hypeUsers: Set<string>;
  emoteMessages: number;
};

type Pending = {
  triggerSecond: number;
  maxScore: number;
  maxZ: number;
  reasons: Set<string>;
  baselineMean: number;
  baselineStd: number;
  peakSmoothed: number;
  lastStrongSecond: number;
};

export type TriggerScore = {
  score: number;
  zScore: number;
  rate: number;
  mean: number;
  std: number;
  shortMessages: number;
  users: number;
  reasons: string[];
};

/**
 * Per-channel chat burst detector.
 *
 * 1. Counts messages in 1 s bins (silent seconds count as zero).
 * 2. Triggers when the 5 s rate jumps well above the 60 s baseline and the
 *    burst is broad (several users, hype words, or an emote flood).
 * 3. Keeps collecting until the burst settles, then emits one moment with the
 *    real peak (3-bin smoothed maximum) and the onset of the burst. Bursts that
 *    overlap are merged; a cooldown starts when a burst ends.
 *
 * Call `tick(nowMs)` about once a second so a burst can settle when chat goes
 * quiet. Times are chat-receive times; the pipeline maps them to video time.
 */
export class ChannelSpikeDetector {
  private readonly bins = new Map<number, Bin>();
  private firstSecond: number | undefined;
  private pending: Pending | undefined;
  private lastBurstEndMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly channelLogin: string,
    private readonly options: SpikeDetectorOptions = {},
  ) {}

  ingest(event: ChatEvent): CandidateMoment | null {
    const at = Date.parse(event.receivedAt);
    if (!Number.isFinite(at)) return null;
    this.add(event, at);
    this.prune(at);
    if (this.pending) {
      this.updatePending(at);
      return this.maybeSettle(at);
    }
    this.maybeTrigger(at);
    return null;
  }

  /** Settle a pending burst when chat has gone quiet. */
  tick(nowMs: number): CandidateMoment | null {
    if (!this.pending) return null;
    this.prune(nowMs);
    this.updatePending(nowMs);
    return this.maybeSettle(nowMs);
  }

  get isPending(): boolean {
    return this.pending !== undefined;
  }

  private add(event: ChatEvent, at: number): void {
    const second = Math.floor(at / 1000);
    this.firstSecond ??= second;
    let bin = this.bins.get(second);
    if (!bin) {
      bin = { messages: 0, users: new Map(), hypeUsers: new Set(), emoteMessages: 0 };
      this.bins.set(second, bin);
    }
    bin.messages += 1;
    bin.users.set(event.userLogin, (bin.users.get(event.userLogin) ?? 0) + 1);
    const lowered = event.text.toLowerCase();
    if (HYPE_KEYWORDS.some((keyword) => lowered.includes(keyword)) || /\bclip\b/u.test(lowered)) {
      bin.hypeUsers.add(event.userLogin);
    }
    const tokens = tokenize(event.text);
    const emoteTokens = [...event.emoteTokens.map((token) => token.toLowerCase()), ...tokens];
    if (emoteTokens.some((token) => FLOOD_EMOTES.has(token) || /^w+$/u.test(token))) {
      bin.emoteMessages += 1;
    }
  }

  private prune(nowMs: number): void {
    const cutoff =
      Math.floor(nowMs / 1000) - BASELINE_SECONDS - SHORT_SECONDS - MAX_BURST_SECONDS - 5;
    for (const second of this.bins.keys()) {
      if (second < cutoff) this.bins.delete(second);
    }
  }

  private count(second: number): number {
    return this.bins.get(second)?.messages ?? 0;
  }

  /** Score the 5 s window ending at `second` against the preceding baseline. */
  scoreAt(second: number): TriggerScore {
    const first = this.firstSecond ?? second;
    const shortSeconds = Array.from({ length: SHORT_SECONDS }, (_, i) => second - i);
    const baselineSeconds: number[] = [];
    for (let s = second - SHORT_SECONDS; s > second - SHORT_SECONDS - BASELINE_SECONDS; s -= 1) {
      if (s < first) break;
      baselineSeconds.push(s);
    }
    const shortMessages = shortSeconds.reduce((sum, s) => sum + this.count(s), 0);
    const rate = shortMessages / SHORT_SECONDS;
    const baseline = baselineSeconds.map((s) => this.count(s));
    const mean = baseline.length > 0 ? baseline.reduce((a, b) => a + b, 0) / baseline.length : 0;
    const variance =
      baseline.length > 1
        ? baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (baseline.length - 1)
        : 0;
    const std = Math.sqrt(variance);
    const coverage = baseline.length;
    // Floor the spread so a very steady chat does not produce huge z-scores.
    const zScore = coverage >= 15 ? (rate - mean) / Math.max(std, 0.5) : rate >= 3 ? 2.5 : 0;
    const relativeJump = rate >= mean * 1.8 + 0.8;

    const users = new Map<string, number>();
    const hypeUsers = new Set<string>();
    let emoteMessages = 0;
    for (const s of shortSeconds) {
      const bin = this.bins.get(s);
      if (!bin) continue;
      for (const [user, n] of bin.users) users.set(user, (users.get(user) ?? 0) + n);
      for (const user of bin.hypeUsers) hypeUsers.add(user);
      emoteMessages += bin.emoteMessages;
    }
    const uniqueRatio = shortMessages > 0 ? users.size / shortMessages : 0;
    const hypeShare = shortMessages > 0 ? hypeUsers.size / Math.max(users.size, 1) : 0;
    const emoteShare = shortMessages > 0 ? emoteMessages / shortMessages : 0;
    const topUserShare = shortMessages > 0 ? Math.max(0, ...users.values()) / shortMessages : 0;

    const reasons: string[] = [];
    if (zScore >= 2.5 && relativeJump) reasons.push("rate-spike");
    if (hypeUsers.size >= 2) reasons.push("keyword:hype");
    if (emoteShare >= 0.4 && shortMessages >= 6) reasons.push("emote-flood");

    let score = Math.min(50, Math.max(0, zScore) * 12);
    if (hypeUsers.size >= 2) score += hypeShare >= 0.3 ? 25 : 12;
    if (reasons.includes("emote-flood")) score += 15;
    if (uniqueRatio >= 0.5 && shortMessages >= 6) score += 10;
    if (uniqueRatio < 0.25 && shortMessages >= 8) score -= 15; // a few users spamming
    if (topUserShare > 0.4) score -= 30; // one user dominates the window
    if (!relativeJump) score -= 20;
    return {
      score: Math.round(Math.min(100, Math.max(0, score))),
      zScore: Number(zScore.toFixed(2)),
      rate: Number(rate.toFixed(2)),
      mean: Number(mean.toFixed(2)),
      std: Number(std.toFixed(2)),
      shortMessages,
      users: users.size,
      reasons,
    };
  }

  private maybeTrigger(at: number): void {
    const cooldown = this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    if (at - this.lastBurstEndMs < cooldown) return;
    const second = Math.floor(at / 1000);
    const result = this.scoreAt(second);
    const minScore = this.options.minScore ?? DEFAULT_MIN_SCORE;
    const minMessages = this.options.minMessages ?? DEFAULT_MIN_MESSAGES;
    const strongEnough =
      result.reasons.includes("rate-spike") || (result.reasons.length > 0 && result.zScore >= 1.2);
    const minUsers = this.options.minUsers ?? DEFAULT_MIN_USERS;
    if (
      result.score < minScore ||
      result.shortMessages < minMessages ||
      result.users < minUsers ||
      !strongEnough
    ) {
      return;
    }
    this.pending = {
      triggerSecond: second,
      maxScore: result.score,
      maxZ: result.zScore,
      reasons: new Set(result.reasons),
      baselineMean: result.mean,
      baselineStd: result.std,
      peakSmoothed: 0,
      lastStrongSecond: second,
    };
    this.updatePending(at);
  }

  private updatePending(nowMs: number): void {
    const pending = this.pending;
    if (!pending) return;
    const now = Math.floor(nowMs / 1000);
    const current = this.scoreAt(now);
    if (current.score > pending.maxScore) pending.maxScore = current.score;
    if (current.zScore > pending.maxZ) pending.maxZ = current.zScore;
    for (const reason of current.reasons) pending.reasons.add(reason);
    const smoothed = smoothBins(this.window(pending.triggerSecond - 3, now));
    for (const bin of smoothed) {
      if (bin.second < pending.triggerSecond - 3) continue;
      if (bin.messages > pending.peakSmoothed) pending.peakSmoothed = bin.messages;
    }
    const strong = Math.max(pending.baselineMean + pending.baselineStd, pending.peakSmoothed * 0.5);
    for (const bin of smoothed) {
      if (bin.messages >= strong && bin.second > pending.lastStrongSecond) {
        pending.lastStrongSecond = bin.second;
      }
    }
  }

  private window(fromSecond: number, toSecond: number): RateBin[] {
    const out: RateBin[] = [];
    for (let s = fromSecond; s <= toSecond; s += 1)
      out.push({ second: s, messages: this.count(s) });
    return out;
  }

  private maybeSettle(nowMs: number): CandidateMoment | null {
    const pending = this.pending;
    if (!pending) return null;
    const now = Math.floor(nowMs / 1000);
    const quietFor = now - pending.lastStrongSecond;
    const age = now - pending.triggerSecond;
    if (quietFor < SETTLE_QUIET_SECONDS && age < MAX_BURST_SECONDS) return null;

    const smoothed = smoothBins(this.window(pending.triggerSecond - 15, now));
    const searchable = smoothed.filter((bin) => bin.second >= pending.triggerSecond - 4);
    const peakSecond = findPeakSecond(searchable) ?? pending.triggerSecond;
    const threshold = Math.max(
      pending.baselineMean + pending.baselineStd,
      pending.baselineMean + 0.5,
    );
    const onsetSecond = findOnsetSecond(smoothed, peakSecond, threshold, 12);
    const endSecond = Math.max(peakSecond, pending.lastStrongSecond);
    const peakRate = smoothed.find((bin) => bin.second === peakSecond)?.messages ?? 0;

    this.pending = undefined;
    this.lastBurstEndMs = (endSecond + 1) * 1000;
    const reasons = [...pending.reasons];
    if (reasons.length === 0) reasons.push("rate-spike");
    return {
      id: randomUUID(),
      channelLogin: this.channelLogin,
      channelId: undefined,
      startedAt: new Date(onsetSecond * 1000).toISOString(),
      peakAt: new Date(peakSecond * 1000 + 500).toISOString(),
      burstStartAt: new Date(onsetSecond * 1000).toISOString(),
      burstEndAt: new Date((endSecond + 1) * 1000).toISOString(),
      hypeScore: pending.maxScore,
      reasons,
      messageRate: Number(peakRate.toFixed(2)),
      baselineRate: Number(pending.baselineMean.toFixed(2)),
      zScore: Number(pending.maxZ.toFixed(2)),
    };
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/u)
    .map((token) =>
      token.replace(
        /^[^\p{L}\p{N}\p{Extended_Pictographic}]+|[^\p{L}\p{N}\p{Extended_Pictographic}]+$/gu,
        "",
      ),
    )
    .filter(Boolean);
}
