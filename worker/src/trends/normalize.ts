/** Where a search term came from. */
export type TrendSource = "youtube-suggest" | "google-suggest" | "youtube-api" | "curated";

export type TrendTerm = {
  /** Raw search phrase, e.g. "gta 6 funny npc moments". */
  term: string;
  /** 0-1: how strongly the phrase is searched (rank-based for autocomplete). */
  weight: number;
  source: TrendSource;
};

/** A term reduced to canonical content tokens, e.g. ["funny", "npc"]. */
export type TrendTopic = {
  key: string;
  label: string;
  tokens: string[];
  weight: number;
  sources: TrendSource[];
};

/**
 * Word forms -> one canonical token. Small on purpose: slang Whisper actually
 * writes in GTA streams, plus the phrasing people search for.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  police: ["police", "cop", "cops", "popo", "feds", "swat", "sheriff", "wanted", "stars"],
  chase: ["chase", "chased", "chasing", "pursuit", "chasin"],
  glitch: ["glitch", "glitches", "glitched", "glitching", "glitchy", "bug", "bugged", "buggy"],
  fail: ["fail", "fails", "failed", "failing", "fumble", "fumbled", "choke", "choked"],
  funny: ["funny", "funniest", "hilarious", "lol", "lmao", "lmfao", "laugh", "laughing", "comedy"],
  npc: ["npc", "npcs", "pedestrian", "pedestrians", "civilian", "civilians", "ped", "peds"],
  rage: ["rage", "raging", "raged", "mad", "angry", "tilted", "furious", "ragequit"],
  crash: ["crash", "crashed", "crashing", "wreck", "wrecked", "totaled", "totalled"],
  car: ["car", "cars", "vehicle", "vehicles", "whip", "truck"],
  heist: ["heist", "heists", "robbery", "rob", "robbing", "robbed"],
  bank: ["bank", "banks", "vault"],
  money: ["money", "cash", "bands", "dollars", "racks"],
  kill: ["kill", "kills", "killed", "killing", "murder", "murdered", "sniped"],
  shoot: ["shoot", "shooting", "shot", "shootout", "gunfight"],
  fight: ["fight", "fights", "fighting", "fought", "punch", "punched", "brawl"],
  insane: ["insane", "crazy", "wild", "unreal", "nuts", "cracked"],
  stunt: ["stunt", "stunts", "flip", "flipped", "backflip"],
  jump: ["jump", "jumps", "jumped", "jumping"],
  alligator: ["alligator", "alligators", "gator", "gators", "crocodile", "croc"],
  helicopter: ["helicopter", "helicopters", "heli", "chopper"],
  motorcycle: ["motorcycle", "motorcycles", "motorbike", "bike", "bikes"],
  boat: ["boat", "boats", "jetski", "yacht"],
  cheat: ["cheat", "cheats", "cheating", "cheatcode"],
  ending: ["ending", "endings"],
  scary: ["scary", "creepy", "scared", "jumpscare"],
  troll: ["troll", "trolling", "trolled", "prank", "pranked"],
  ragdoll: ["ragdoll", "ragdolled", "ragdolling"],
  physics: ["physics"],
  clutch: ["clutch", "clutched"],
  quit: ["quit", "quits", "quitting"],
  trailer: ["trailer", "trailers"],
  vice: ["vice"],
  city: ["city"],
  lucia: ["lucia"],
  jason: ["jason"],
};

const CANONICAL = new Map<string, string>();
for (const [canonical, forms] of Object.entries(SYNONYMS)) {
  for (const form of forms) CANONICAL.set(form, canonical);
}

/** Tokens that carry no topic on their own ("gta 6 funny moments" -> funny). */
const FILLER = new Set([
  "gta",
  "6",
  "vi",
  "six",
  "grand",
  "theft",
  "auto",
  "the",
  "a",
  "an",
  "in",
  "on",
  "of",
  "and",
  "to",
  "for",
  "with",
  "be",
  "like",
  "is",
  "are",
  "it",
  "this",
  "that",
  "my",
  "you",
  "i",
  "best",
  "new",
  "top",
  "most",
  "all",
  "every",
  "video",
  "videos",
  "clip",
  "clips",
  "moment",
  "moments",
  "compilation",
  "meme",
  "memes",
  "reaction",
  "reactions",
  "react",
  "game",
  "gameplay",
  "playthrough",
  "part",
  "chapter",
  "episode",
  "online",
  "edition",
  "full",
  "official",
  "real",
  "life",
  "2025",
  "2026",
  "2027",
  "1",
  "2",
  "3",
  "vs",
  "stream",
  "streamer",
  "streamers",
  "streaming",
  "twitch",
]);

/** Topics about news/store pages, not something that happens on stream. */
const NON_MOMENT = new Set([
  "release",
  "date",
  "price",
  "preorder",
  "pre",
  "order",
  "delay",
  "delayed",
  "download",
  "apk",
  "leak",
  "leaks",
  "leaked",
  "pc",
  "ps5",
  "ps4",
  "xbox",
  "review",
  "news",
  "size",
  "gb",
  "map",
  "countdown",
  "when",
  "requirements",
  "specs",
  "free",
  "ost",
  "soundtrack",
  "song",
  "songs",
  "music",
  "radio",
  "engine",
  "graphics",
  "features",
  "clothing",
  "clothes",
  "outfit",
  "outfits",
  "theory",
  "theories",
  "explained",
  "cast",
  "actor",
  "actress",
  "wallpaper",
  "font",
  "logo",
  "mod",
  "mods",
]);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/grand theft auto\s*(vi|6|six)\b/gu, " gta 6 ")
    .replace(/\bgta\s*(vi|6|six)\b/gu, " gta 6 ")
    .replace(/rage[\s-]?quit/gu, "rage quit")
    .replace(/cheat[\s-]?code/gu, "cheat code")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function canonicalToken(word: string): string {
  return CANONICAL.get(word) ?? word;
}

/** Canonical tokens of free text (transcripts), fillers kept out. */
export function textTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalizeText(text).split(" ")) {
    if (!word || FILLER.has(word)) continue;
    out.add(canonicalToken(word));
  }
  return out;
}

/** Search phrase -> topic tokens; undefined for news-only or empty phrases. */
export function topicTokens(term: string): string[] | undefined {
  const tokens: string[] = [];
  for (const word of normalizeText(term).split(" ")) {
    if (!word || FILLER.has(word)) continue;
    if (NON_MOMENT.has(word)) return undefined;
    const canonical = canonicalToken(word);
    if (!tokens.includes(canonical)) tokens.push(canonical);
  }
  if (tokens.length === 0 || tokens.length > 4) return undefined;
  return tokens;
}

/**
 * Collapse raw terms into topics keyed by their sorted canonical tokens.
 * Duplicates keep the max weight plus a small bonus per extra source/seed.
 */
export function buildTopics(terms: readonly TrendTerm[]): TrendTopic[] {
  const byKey = new Map<string, TrendTopic & { hits: number }>();
  for (const item of terms) {
    const tokens = topicTokens(item.term);
    if (!tokens) continue;
    const key = [...tokens].sort().join(" ");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        label: normalizeText(item.term),
        tokens,
        weight: clamp01(item.weight),
        sources: [item.source],
        hits: 1,
      });
      continue;
    }
    existing.hits += 1;
    if (item.weight > existing.weight) {
      existing.weight = clamp01(item.weight);
      existing.label = normalizeText(item.term);
    }
    if (!existing.sources.includes(item.source)) existing.sources.push(item.source);
  }
  return [...byKey.values()]
    .map(({ hits, ...topic }) => ({
      ...topic,
      weight: Number(clamp01(topic.weight + 0.05 * (hits - 1)).toFixed(3)),
    }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
