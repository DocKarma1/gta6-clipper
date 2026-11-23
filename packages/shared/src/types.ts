export type LiveStream = {
  id: string;
  streamerLogin: string;
  streamerName: string;
  title: string;
  viewerCount: number;
  language: string;
  thumbnailUrl: string;
  url: string;
  startedAt: string;
  gameName: string;
};

export type GameCategory = {
  id: string;
  name: string;
};

export type LiveRadarResult = {
  game: GameCategory;
  streams: LiveStream[];
  fetchedAt: string;
};
