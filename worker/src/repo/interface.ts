import type { CandidateMoment, ClipRecord, WatchedStream } from "@gta6-clipper/shared";

export interface ClipperRepository {
  upsertStream(stream: WatchedStream): Promise<void>;
  saveMoment(moment: CandidateMoment): Promise<void>;
  saveClip(clip: ClipRecord): Promise<void>;
  listRecentMoments(limit: number): Promise<CandidateMoment[]>;
  listRecentClips(limit: number): Promise<ClipRecord[]>;
  countClipsSince(isoTimestamp: string): Promise<number>;
  /** Mark clips left in "rendering" by a previous run as failed; returns how many. */
  markInterruptedClips?(): Promise<number>;
  close?: () => void;
}
