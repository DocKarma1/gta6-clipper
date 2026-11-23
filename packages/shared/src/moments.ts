export type ChatEvent = {
  channelLogin: string;
  userLogin: string;
  text: string;
  emoteTokens: string[];
  receivedAt: string;
};

export type CandidateMoment = {
  id: string;
  channelLogin: string;
  channelId: string | undefined;
  startedAt: string;
  peakAt: string;
  hypeScore: number;
  reasons: string[];
  messageRate: number;
  baselineRate: number;
  zScore: number;
  /** Chat-time onset of the burst (first second clearly above baseline). */
  burstStartAt?: string;
  /** Chat-time moment the burst settled back down. */
  burstEndAt?: string;
};

export type ClipRecord = {
  id: string;
  momentId: string;
  channelLogin: string;
  layout: "stacked-split" | "blurred-background";
  sourcePath: string;
  outputPath: string;
  posterPath: string | undefined;
  startedAt: string;
  durationSeconds: number;
  hookTitle: string;
  status: "rendering" | "ready" | "failed";
  errorMessage: string | undefined;
  createdAt: string;
  /** Estimated on-screen time of the event (chat onset minus chat delay). */
  eventAt?: string;
  /** Chat peak mapped to video time. */
  peakAt?: string;
  highlightStartAt?: string;
  highlightEndAt?: string;
  /** Seconds from the start of the MP4 to the peak (thumbnail frame). */
  peakOffsetSeconds?: number;
  hypeScore?: number;
};

export type WatchedStream = {
  channelLogin: string;
  channelId: string | undefined;
  title: string;
  language: string;
  viewerCount: number;
  thumbnailUrl: string;
  url: string;
};
