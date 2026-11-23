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
