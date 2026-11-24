import type { TrendTerm } from "./normalize";

/**
 * Autocomplete seeds, biased toward what young viewers type for clip content
 * (funny / fails / glitches / NPCs / chases) rather than release-date news.
 */
export const DEFAULT_YOUTUBE_SEEDS = [
  "gta 6",
  "gta 6 funny",
  "gta 6 funniest",
  "gta 6 glitch",
  "gta 6 npc",
  "gta 6 fail",
  "gta 6 police",
  "gta 6 rage",
  "gta 6 crazy",
  "gta 6 moments",
  "gta 6 streamer",
  "gta 6 lucia",
] as const;

export const DEFAULT_GOOGLE_SEEDS = ["gta 6", "gta 6 funny", "gta 6 glitch"] as const;

/**
 * Curated, offline topic list. Always merged under live terms (lower weight)
 * so clip-shaped topics survive when autocomplete is dominated by news.
 */
const CURATED: readonly string[] = [
  "gta 6 glitch",
  "gta 6 money glitch",
  "gta 6 funny moments",
  "gta 6 funniest npc",
  "gta 6 npc reactions",
  "gta 6 npc fight",
  "gta 6 police chase",
  "gta 6 wanted level",
  "gta 6 fails",
  "gta 6 car crash",
  "gta 6 rage",
  "gta 6 rage quit",
  "gta 6 insane stunt",
  "gta 6 jump",
  "gta 6 heist",
  "gta 6 bank robbery",
  "gta 6 alligator",
  "gta 6 vice city",
  "gta 6 lucia",
  "gta 6 jason",
  "gta 6 easter egg",
  "gta 6 cheat code",
  "gta 6 helicopter",
  "gta 6 boat",
  "gta 6 motorcycle",
  "gta 6 physics",
  "gta 6 ragdoll",
  "gta 6 clutch",
  "gta 6 trolling",
  "gta 6 scary",
];

export const CURATED_WEIGHT = 0.5;

export function curatedTerms(): TrendTerm[] {
  return CURATED.map((term) => ({ term, weight: CURATED_WEIGHT, source: "curated" as const }));
}
