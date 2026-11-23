/**
 * Pure helpers that turn a chat burst into a video window.
 * All times are epoch milliseconds unless the name says seconds.
 */

export type RateBin = { second: number; messages: number };

/** Centered moving average over 1 s bins (radius 1 => 3-bin window). */
export function smoothBins(bins: readonly RateBin[], radius = 1): RateBin[] {
  if (bins.length === 0) return [];
  const sorted = [...bins].sort((a, b) => a.second - b.second);
  const first = sorted[0]!.second;
  const last = sorted.at(-1)!.second;
  const dense = new Map(sorted.map((bin) => [bin.second, bin.messages]));
  const out: RateBin[] = [];
  for (let second = first; second <= last; second += 1) {
    let sum = 0;
    let n = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const key = second + offset;
      if (key < first || key > last) continue;
      sum += dense.get(key) ?? 0;
      n += 1;
    }
    out.push({ second, messages: n > 0 ? sum / n : 0 });
  }
  return out;
}

/** Second with the highest smoothed rate; ties resolve to the earliest. */
export function findPeakSecond(smoothed: readonly RateBin[]): number | undefined {
  let best: RateBin | undefined;
  for (const bin of smoothed) {
    if (!best || bin.messages > best.messages) best = bin;
  }
  return best?.second;
}

/**
 * Walk back from the peak to the first second that is still clearly above
 * the baseline. That onset is when chat started reacting.
 */
export function findOnsetSecond(
  smoothed: readonly RateBin[],
  peakSecond: number,
  threshold: number,
  maxLookbackSeconds = 12,
): number {
  let onset = peakSecond;
  const bySecond = new Map(smoothed.map((bin) => [bin.second, bin.messages]));
  for (let second = peakSecond - 1; second >= peakSecond - maxLookbackSeconds; second -= 1) {
    const value = bySecond.get(second);
    if (value === undefined || value <= threshold) break;
    onset = second;
  }
  return onset;
}

export type ClipWindowInput = {
  burstStartMs: number;
  peakMs: number;
  burstEndMs: number;
  chatDelaySeconds: number;
  preRollSeconds: number;
  postRollSeconds: number;
  minSeconds: number;
  maxSeconds: number;
};

export type ClipWindow = {
  startMs: number;
  endMs: number;
  /** Estimated on-screen event time (burst onset minus chat delay). */
  eventMs: number;
  /** Chat peak mapped back to video time. */
  peakVideoMs: number;
};

/**
 * Window around the event. Chat reacts after the moment, so the event is the
 * burst onset minus the chat delay. Lead-in grows a little with longer bursts
 * (bigger moments usually have more build-up). Lead-out ends shortly after
 * the peak. The result respects [minSeconds, maxSeconds].
 */
export function planClipWindow(input: ClipWindowInput): ClipWindow {
  const delayMs = input.chatDelaySeconds * 1000;
  const eventMs = input.burstStartMs - delayMs;
  const peakVideoMs = Math.max(eventMs, input.peakMs - delayMs);
  const burstSeconds = Math.max(0, (input.burstEndMs - input.burstStartMs) / 1000);
  const leadIn = Math.min(input.preRollSeconds + burstSeconds * 0.5, input.preRollSeconds + 8);
  let startMs = eventMs - leadIn * 1000;
  let endMs = Math.max(peakVideoMs + input.postRollSeconds * 1000, eventMs + 4_000);

  const minMs = input.minSeconds * 1000;
  const maxMs = Math.max(minMs, input.maxSeconds * 1000);
  const length = endMs - startMs;
  if (length < minMs) {
    const missing = minMs - length;
    startMs -= missing * 0.7;
    endMs += missing * 0.3;
  } else if (length > maxMs) {
    const excess = length - maxMs;
    const trimStart = Math.min(excess, Math.max(0, eventMs - 3_000 - startMs));
    startMs += trimStart;
    endMs -= excess - trimStart;
  }
  return {
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    eventMs: Math.round(eventMs),
    peakVideoMs: Math.round(peakVideoMs),
  };
}

export type CutHints = {
  /** Silence intervals in ms (absolute). */
  silences: readonly { startMs: number; endMs: number }[];
  /** Scene-change timestamps in ms (absolute). */
  sceneCuts: readonly number[];
};

export type SnappedWindow = ClipWindow & {
  snappedStart: "silence" | "scene" | "none";
  snappedEnd: "silence" | "scene" | "none";
};

/**
 * Move the cut points to a nearby natural boundary when one is close:
 * start -> end of a silence or a scene cut, end -> start of a silence or a
 * scene cut. Never moves the start past (event - 2 s) or the end before
 * (peak + 1 s), and never shifts by more than maxShiftMs.
 */
export function snapWindow(window: ClipWindow, hints: CutHints, maxShiftMs = 1_500): SnappedWindow {
  const latestStart = window.eventMs - 2_000;
  const earliestEnd = window.peakVideoMs + 1_000;

  const startCandidates = [
    ...hints.silences.map((item) => ({ at: item.endMs, kind: "silence" as const })),
    ...hints.sceneCuts.map((at) => ({ at, kind: "scene" as const })),
  ].filter(
    (item) =>
      item.at <= latestStart &&
      item.at >= window.startMs - maxShiftMs &&
      item.at <= window.startMs + maxShiftMs,
  );
  const endCandidates = [
    ...hints.silences.map((item) => ({ at: item.startMs, kind: "silence" as const })),
    ...hints.sceneCuts.map((at) => ({ at, kind: "scene" as const })),
  ].filter(
    (item) =>
      item.at >= earliestEnd &&
      item.at >= window.endMs - maxShiftMs &&
      item.at <= window.endMs + maxShiftMs,
  );

  const nearest = <T extends { at: number; kind: "silence" | "scene" }>(
    items: T[],
    target: number,
  ): T | undefined =>
    items.sort(
      (a, b) =>
        Math.abs(a.at - target) - Math.abs(b.at - target) ||
        (a.kind === "silence" ? -1 : 1) - (b.kind === "silence" ? -1 : 1),
    )[0];

  const start = nearest(startCandidates, window.startMs);
  const end = nearest(endCandidates, window.endMs);
  return {
    ...window,
    startMs: start ? Math.round(start.at) : window.startMs,
    endMs: end ? Math.round(end.at) : window.endMs,
    snappedStart: start?.kind ?? "none",
    snappedEnd: end?.kind ?? "none",
  };
}

/** Parse ffmpeg silencedetect stderr into intervals (seconds relative to input). */
export function parseSilenceDetect(stderr: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let pending: number | undefined;
  for (const line of stderr.split("\n")) {
    const start = /silence_start:\s*(-?[\d.]+)/u.exec(line);
    if (start) pending = Math.max(0, Number(start[1]));
    const end = /silence_end:\s*([\d.]+)/u.exec(line);
    if (end && pending !== undefined) {
      out.push({ start: pending, end: Number(end[1]) });
      pending = undefined;
    }
  }
  return out;
}

/** Parse showinfo pts_time values printed after a scene-select filter. */
export function parseSceneCuts(stderr: string): number[] {
  const out: number[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.includes("Parsed_showinfo")) continue;
    const match = /pts_time:\s*([\d.]+)/u.exec(line);
    if (match) out.push(Number(match[1]));
  }
  return out;
}

export type TimedWordLike = { text: string; start: number; end: number };

/**
 * Shift caption words from source-file time into clip time and drop words
 * outside [0, durationSeconds]. Partly visible words are clamped.
 */
export function alignWordsToWindow<T extends TimedWordLike>(
  words: readonly T[],
  offsetSeconds: number,
  durationSeconds: number,
): T[] {
  const out: T[] = [];
  for (const word of words) {
    const start = word.start - offsetSeconds;
    const end = word.end - offsetSeconds;
    if (end <= 0.05 || start >= durationSeconds - 0.05) continue;
    out.push({
      ...word,
      start: Math.max(0, Number(start.toFixed(3))),
      end: Math.min(durationSeconds, Number(end.toFixed(3))),
    });
  }
  return out;
}
