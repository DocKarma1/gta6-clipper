import { randomUUID } from "node:crypto";
import type { CandidateMoment, ChatEvent } from "@gta6-clipper/shared";

/** Replies are counted this long after the question (chat time). */
export const REPLY_WINDOW_SECONDS = 10;
/** Distinct repliers must reach this multiple of the baseline... */
export const REPLY_BASELINE_MULTIPLE = 1.5;
/** ...and at least this many distinct chatters. */
export const MIN_DISTINCT_REPLIERS = 8;
const BASELINE_SECONDS = 60;
const HISTORY_SECONDS = 180;

export type QuestionSource = "chat" | "speech";
export type Question = { atMs: number; source: QuestionSource; text: string };

type TimedWord = { text: string; start: number; end: number };

/** A broadcaster chat line counts as a question when it ends with "?". */
export function isBroadcasterQuestion(event: ChatEvent): boolean {
  return (
    event.userLogin.toLowerCase() === event.channelLogin.toLowerCase() &&
    event.text.trim().endsWith("?")
  );
}

/** Words that usually open a question (en / sv / es). */
const QUESTION_OPENERS = new Set([
  "did",
  "do",
  "does",
  "what",
  "why",
  "how",
  "who",
  "where",
  "when",
  "which",
  "is",
  "are",
  "can",
  "could",
  "would",
  "should",
  "will",
  "have",
  "has",
  "anyone",
  "vad",
  "varför",
  "hur",
  "vem",
  "var",
  "när",
  "vilken",
  "har",
  "är",
  "kan",
  "ska",
  "qué",
  "que",
  "por",
  "cómo",
  "como",
  "quién",
  "dónde",
  "cuándo",
  "cuál",
]);

/**
 * Questions in a transcript: sentences whose last word ends with "?".
 * Whisper often drops the full stop before a question, so the question is
 * taken to start at the last question opener (did/what/vad/qué ...) in the
 * sentence, or at most 12 words before the "?".
 * Returns the question text and its start time in seconds.
 */
export function findSpokenQuestions(
  words: readonly TimedWord[],
): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let sentence: TimedWord[] = [];
  for (const word of words) {
    sentence.push(word);
    const trimmed = word.text.trim();
    if (/[.!?]$/u.test(trimmed)) {
      if (trimmed.endsWith("?") && sentence.length >= 2) {
        let from = Math.max(0, sentence.length - 12);
        for (let i = sentence.length - 2; i >= from; i -= 1) {
          const bare = sentence[i]!.text.trim()
            .toLowerCase()
            .replace(/[^\p{L}]/gu, "");
          if (QUESTION_OPENERS.has(bare)) {
            from = i;
            break;
          }
        }
        const question = sentence.slice(from);
        out.push({
          start: question[0]!.start,
          text: question.map((item) => item.text.trim()).join(" "),
        });
      }
      sentence = [];
    }
  }
  return out;
}

/**
 * Minimal question -> replies pattern. A question (spoken, from the buffer
 * transcript, or a broadcaster chat line ending in "?") is a highlight when
 * the number of distinct chatters in the 10 s after it is at least
 * max(8, 1.5 x the rolling baseline of distinct chatters per 10 s).
 *
 * Questions may be noted late (speech is transcribed in batches), so chat
 * history is kept for a few minutes and questions are evaluated once their
 * reply window has passed. Call tick() about once a second.
 */
export class QuestionReplyDetector {
  private readonly users = new Map<number, Set<string>>();
  private readonly pending: Question[] = [];
  private lastQuestionMs = Number.NEGATIVE_INFINITY;
  private firstSecond: number | undefined;

  constructor(
    private readonly channelLogin: string,
    private readonly options: { cooldownMs?: number } = {},
  ) {}

  ingest(event: ChatEvent): void {
    const at = Date.parse(event.receivedAt);
    if (!Number.isFinite(at)) return;
    if (isBroadcasterQuestion(event)) {
      this.noteQuestion({ atMs: at, source: "chat", text: event.text.trim() });
      return;
    }
    const second = Math.floor(at / 1000);
    this.firstSecond ??= second;
    let set = this.users.get(second);
    if (!set) {
      set = new Set();
      this.users.set(second, set);
    }
    set.add(event.userLogin.toLowerCase());
  }

  noteQuestion(question: Question): void {
    // Questions close together are one question; keep the earliest.
    const near = this.pending.find(
      (item) => Math.abs(item.atMs - question.atMs) < REPLY_WINDOW_SECONDS * 1000,
    );
    if (near) {
      if (question.atMs < near.atMs) Object.assign(near, question);
      return;
    }
    this.pending.push({ ...question });
  }

  /** Distinct chatters in [fromMs, toMs). */
  distinctBetween(fromMs: number, toMs: number): number {
    const set = new Set<string>();
    for (let s = Math.floor(fromMs / 1000); s < Math.floor(toMs / 1000); s += 1) {
      for (const user of this.users.get(s) ?? []) set.add(user);
    }
    return set.size;
  }

  /** Average distinct chatters per 10 s in the minute before `atMs`. */
  baselineBefore(atMs: number): number {
    const first = (this.firstSecond ?? Math.floor(atMs / 1000)) * 1000;
    const windowMs = REPLY_WINDOW_SECONDS * 1000;
    const samples: number[] = [];
    for (let end = atMs; end - windowMs >= atMs - BASELINE_SECONDS * 1000; end -= windowMs) {
      if (end - windowMs < first) break;
      samples.push(this.distinctBetween(end - windowMs, end));
    }
    return samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
  }

  tick(nowMs: number): CandidateMoment | null {
    const cutoff = Math.floor(nowMs / 1000) - HISTORY_SECONDS;
    for (const second of this.users.keys()) if (second < cutoff) this.users.delete(second);

    const windowMs = REPLY_WINDOW_SECONDS * 1000;
    const readyIndex = this.pending.findIndex((item) => nowMs >= item.atMs + windowMs);
    if (readyIndex < 0) return null;
    const [question] = this.pending.splice(readyIndex, 1);
    if (!question) return null;
    const cooldown = this.options.cooldownMs ?? 45_000;
    if (question.atMs - this.lastQuestionMs < cooldown) return null;

    const repliers = this.distinctBetween(question.atMs, question.atMs + windowMs);
    const baseline = this.baselineBefore(question.atMs);
    const needed = Math.max(MIN_DISTINCT_REPLIERS, REPLY_BASELINE_MULTIPLE * baseline);
    if (repliers < needed) return null;

    // Peak = the busiest second of replies.
    let peakSecond = Math.floor(question.atMs / 1000);
    let peakCount = -1;
    for (
      let s = Math.floor(question.atMs / 1000);
      s < Math.floor((question.atMs + windowMs) / 1000);
      s += 1
    ) {
      const count = this.users.get(s)?.size ?? 0;
      if (count > peakCount) {
        peakCount = count;
        peakSecond = s;
      }
    }
    this.lastQuestionMs = question.atMs;
    const ratio = baseline > 0 ? repliers / baseline : repliers;
    return {
      id: randomUUID(),
      channelLogin: this.channelLogin,
      channelId: undefined,
      kind: "question_reply",
      questionAt: new Date(question.atMs).toISOString(),
      questionSource: question.source,
      questionText: question.text.slice(0, 200),
      startedAt: new Date(question.atMs).toISOString(),
      burstStartAt: new Date(question.atMs).toISOString(),
      peakAt: new Date(peakSecond * 1000 + 500).toISOString(),
      burstEndAt: new Date(question.atMs + windowMs).toISOString(),
      hypeScore: Math.round(Math.min(100, 50 + (ratio - REPLY_BASELINE_MULTIPLE) * 25)),
      reasons: ["question-reply", `question:${question.source}`],
      messageRate: repliers,
      baselineRate: Number(baseline.toFixed(2)),
      zScore: Number(ratio.toFixed(2)),
    };
  }
}
