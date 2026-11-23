export type PlanId = "starter" | "pro" | "studio";

export type Plan = {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  yearlyMonthlyUsd: number;
  streamsAtOnce: number;
  youtubeImportsPerMonth: number;
  youtubeMaxHours: number;
  clipsPerMonth: number;
  captionStyles: number;
  brandColours: boolean;
  aiTitles: boolean;
  autoPost: boolean;
  accountsPerPlatform: number;
  scheduling: boolean;
  seats: number;
  summary: string;
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyUsd: 49,
    yearlyMonthlyUsd: 39,
    streamsAtOnce: 2,
    youtubeImportsPerMonth: 20,
    youtubeMaxHours: 2,
    clipsPerMonth: 200,
    captionStyles: 4,
    brandColours: false,
    aiTitles: false,
    autoPost: false,
    accountsPerPlatform: 0,
    scheduling: false,
    seats: 1,
    summary: "Two live streams, downloadable 1080p Shorts, and the live directory."
  },
  {
    id: "pro",
    name: "Pro",
    monthlyUsd: 99,
    yearlyMonthlyUsd: 79,
    streamsAtOnce: 5,
    youtubeImportsPerMonth: 60,
    youtubeMaxHours: 4,
    clipsPerMonth: 600,
    captionStyles: 8,
    brandColours: true,
    aiTitles: true,
    autoPost: false,
    accountsPerPlatform: 0,
    scheduling: false,
    seats: 1,
    summary: "More concurrency, every caption style, and AI titles plus hashtags."
  },
  {
    id: "studio",
    name: "Studio",
    monthlyUsd: 199,
    yearlyMonthlyUsd: 159,
    streamsAtOnce: 10,
    youtubeImportsPerMonth: 200,
    youtubeMaxHours: 6,
    clipsPerMonth: 2000,
    captionStyles: 8,
    brandColours: true,
    aiTitles: true,
    autoPost: true,
    accountsPerPlatform: 3,
    scheduling: true,
    seats: 3,
    summary: "Ten streams, scheduled auto-post to all four platforms, and team seats."
  }
];
