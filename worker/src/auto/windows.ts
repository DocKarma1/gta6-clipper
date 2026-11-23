import type { AutoSettings, CandidateMoment } from "@gta6-clipper/shared";
import { planClipWindow, type ClipWindow } from "../detect/highlight";

type WindowSettings = Pick<
  AutoSettings,
  "chatDelaySeconds" | "preRollSeconds" | "postRollSeconds" | "minClipSeconds" | "maxClipSeconds"
>;

/** Video window for a regular chat spike. */
export function windowForSpike(moment: CandidateMoment, settings: WindowSettings): ClipWindow {
  const burstStartMs = Date.parse(moment.burstStartAt ?? moment.startedAt);
  const peakMs = Date.parse(moment.peakAt);
  return planClipWindow({
    burstStartMs,
    peakMs,
    burstEndMs: Date.parse(moment.burstEndAt ?? moment.peakAt),
    chatDelaySeconds: settings.chatDelaySeconds,
    preRollSeconds: settings.preRollSeconds,
    postRollSeconds: settings.postRollSeconds,
    minSeconds: settings.minClipSeconds,
    maxSeconds: settings.maxClipSeconds,
  });
}

/**
 * Question -> replies: start 2.5 s before the question, end after the reply
 * peak (mapped to video time) plus the lead-out. Short windows are extended
 * at the end so the question stays near the start.
 */
export function windowForQuestion(moment: CandidateMoment, settings: WindowSettings): ClipWindow {
  const questionMs = Date.parse(moment.questionAt ?? moment.startedAt);
  const peakVideoMs = Math.max(
    questionMs,
    Date.parse(moment.peakAt) - settings.chatDelaySeconds * 1000,
  );
  const startMs = questionMs - 2_500;
  let endMs = peakVideoMs + settings.postRollSeconds * 1000;
  const minMs = settings.minClipSeconds * 1000;
  const maxMs = Math.max(minMs, settings.maxClipSeconds * 1000);
  if (endMs - startMs < minMs) endMs = startMs + minMs;
  if (endMs - startMs > maxMs) endMs = startMs + maxMs;
  return { startMs, endMs, eventMs: questionMs, peakVideoMs };
}

/** Overlap of two windows as a share of the shorter one. */
export function windowOverlap(a: ClipWindow, b: ClipWindow): number {
  const overlap = Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
  const shorter = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
  return shorter > 0 ? overlap / shorter : 0;
}
