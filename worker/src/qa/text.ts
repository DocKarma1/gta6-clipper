/** Small text helpers for speech density and title grounding. */

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does doing don't for from get got had has " +
    "have he her here him his how i i'm if in into is isn't it it's its just let's like me my no not " +
    "now of off oh ok okay on or our out over really right said say says she so some than that that's " +
    "the their them then there these they this those to too up us very was we were what when where which " +
    "who why will with would yeah yes yo you you're your gonna wanna gotta um uh uhh hmm mm ah ahh huh " +
    "lol lmao bro dude guys man"
  ).split(/\s+/u),
);

/** Words that say nothing about this particular clip (brand, platform, hype filler). */
const GENERIC_TITLE_WORDS = new Set(
  (
    "gta gta6 gtavi gta5 vi 6 grand theft auto twitch clip clips clipped stream streamer live chat " +
    "moment moments insane crazy wild epic best funniest funny shorts short tiktok fyp viral " +
    "watch wait end lost it play"
  ).split(/\s+/u),
);

export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .match(/[a-z0-9']+/gu) ?? []
  )
    .map((token) => token.replace(/^'+|'+$/gu, ""))
    .filter(Boolean);
}

/** Crude stemmer: enough to match "explodes" with "exploded" or "cars" with "car". */
export function stem(token: string): string {
  let t = token.replace(/'s$/u, "");
  for (const suffix of ["ing", "ed", "es", "s", "ly"]) {
    if (t.length - suffix.length >= 3 && t.endsWith(suffix)) {
      t = t.slice(0, -suffix.length);
      break;
    }
  }
  return t;
}

export function meaningfulWords(text: string): string[] {
  return tokenize(text).filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/** Content keywords of a title/hook: no stopwords, no brand/hype filler, no streamer name. */
export function titleKeywords(text: string, exclude: string[] = []): string[] {
  const excluded = new Set(exclude.flatMap((value) => tokenize(value)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokenize(text)) {
    if (token.length < 3 || STOPWORDS.has(token) || GENERIC_TITLE_WORDS.has(token)) continue;
    if (excluded.has(token)) continue;
    const key = stem(token);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

/** Share of `keywords` found in `source` (stem or 4+ char prefix match). */
export function keywordOverlap(
  keywords: string[],
  source: string,
): { matched: string[]; missing: string[]; ratio: number } {
  const sourceStems = new Set(tokenize(source).map(stem));
  const sourceList = [...sourceStems];
  const matched: string[] = [];
  const missing: string[] = [];
  for (const keyword of keywords) {
    const s = stem(keyword);
    const hit =
      sourceStems.has(s) ||
      (s.length >= 4 &&
        sourceList.some((w) => w.length >= 4 && (w.startsWith(s) || s.startsWith(w))));
    (hit ? matched : missing).push(keyword);
  }
  return { matched, missing, ratio: keywords.length ? matched.length / keywords.length : 0 };
}

/** Lowercase alphanumerics only, so "CaseOh" matches "caseoh_". */
export function loginKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}
