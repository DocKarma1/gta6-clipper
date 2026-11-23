import type { ChatEvent } from "../twitch/chat";

export type SpikeCandidate = {
  streamId: string;
  startedAt: string;
  peakAt: string;
  hypeScore: number;
  reasons: string[];
};

/**
 * Sliding-window spike detector (rate z-score, keyword hits, emote floods,
 * unique chatter ratio). Implementation lands in Phase 2.
 */
export function scoreWindow(_events: ChatEvent[]): SpikeCandidate | null {
  return null;
}
