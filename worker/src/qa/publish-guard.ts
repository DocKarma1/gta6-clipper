import type { ClipQaSummary, ClipStatus } from "@gta6-clipper/shared";

export type PublishableClip = {
  status: ClipStatus | string;
  qa?: ClipQaSummary | null | undefined;
};

/**
 * Why a clip may not be published, or undefined when it may. A clip must be
 * "ready" AND carry a QA result from an enabled gate where every check passed.
 */
export function publishBlockReason(clip: PublishableClip | undefined): string | undefined {
  if (!clip) return "No clip record was given; refusing to publish.";
  if (clip.status !== "ready") return `Clip status is "${clip.status}", not "ready".`;
  if (!clip.qa) return "Clip has no QA result; run the QA gate first.";
  if (!clip.qa.enabled) return "QA gate was switched off for this clip (QA_GATE=off).";
  if (!clip.qa.passed) {
    return `Clip failed QA: ${clip.qa.failed.join(", ") || "unknown checks"}.`;
  }
  return undefined;
}

export class NotPublishableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NotPublishableError";
  }
}

export function assertPublishable(clip: PublishableClip | undefined): void {
  const reason = publishBlockReason(clip);
  if (reason) throw new NotPublishableError(reason);
}
