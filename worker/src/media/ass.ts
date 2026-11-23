import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  TEXT,
  formatStreamerCredit,
  getSafeZone,
  getTextPlacement,
  type SourceSize,
  type StreamerCredit,
  type TextAlign,
  type TextAnchor,
  type TimedWord,
  type VerticalLayout,
} from "@gta6-clipper/shared";

const ASS_ALIGN: Record<TextAlign, number> = {
  "bottom-left": 1,
  "bottom-center": 2,
  "top-left": 7,
  "top-center": 8,
};

const HIGHLIGHT =
  "{\\c&H0000FFFF&\\fscx80\\fscy80\\t(0,90,\\fscx115\\fscy115)\\t(90,160,\\fscx100\\fscy100)}";

export function escapeAssText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("\r\n", "\\N")
    .replaceAll("\n", "\\N");
}

export function formatAssTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const cs = Math.round(safe * 100);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6_000);
  const s = Math.floor((cs % 6_000) / 100);
  const c = cs % 100;
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(c, 2)}`;
}

export function assAlignment(align: TextAlign): number {
  return ASS_ALIGN[align];
}

export function assPositionOverride(
  anchor: TextAnchor,
  clip: { right: number; bottom: number },
): string {
  const an = assAlignment(anchor.align);
  return `{\\an${an}\\pos(${Math.round(anchor.x)},${Math.round(anchor.y)})\\clip(0,0,${clip.right},${clip.bottom})}`;
}

export type Phrase = {
  words: TimedWord[];
  start: number;
  end: number;
};

/** Group words into short phrases, splitting on pauses longer than 0.6s. */
export function groupPhrases(words: readonly TimedWord[], maxWords = 6): Phrase[] {
  const cleaned = words
    .map((word) => ({ ...word, text: word.text.trim() }))
    .filter(
      (word) => word.text.length > 0 && Number.isFinite(word.start) && Number.isFinite(word.end),
    );
  const phrases: Phrase[] = [];
  let current: TimedWord[] = [];
  for (const word of cleaned) {
    const last = current.at(-1);
    const longGap = last !== undefined && word.start - last.end > 0.6;
    if (current.length >= maxWords || longGap) {
      phrases.push(toPhrase(current));
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) {
    phrases.push(toPhrase(current));
  }
  return phrases;
}

function toPhrase(words: TimedWord[]): Phrase {
  const first = words[0];
  const last = words.at(-1);
  if (!first || !last) {
    return { words: [], start: 0, end: 0 };
  }
  return { words, start: first.start, end: Math.max(last.end, first.start) };
}

function wrapPhrase(words: readonly TimedWord[], maxChars: number): string[] {
  const lines: string[][] = [[]];
  let count = 0;
  for (const word of words) {
    const line = lines.at(-1);
    if (!line) continue;
    const next = count === 0 ? word.text.length : count + 1 + word.text.length;
    if (line.length > 0 && next > maxChars) {
      lines.push([word.text]);
      count = word.text.length;
    } else {
      line.push(word.text);
      count = next;
    }
  }
  return lines.map((line) => line.join(" "));
}

function phraseEventText(phrase: Phrase, activeIndex: number, maxChars: number): string {
  const tokens = phrase.words.map((word, index) => {
    const escaped = escapeAssText(word.text);
    if (index === activeIndex) {
      return `${HIGHLIGHT}${escaped}{\\r}`;
    }
    return `{\\alpha&H60&}${escaped}{\\r}`;
  });
  // Re-wrap by word index so highlight stays on the correct token.
  const lines: string[][] = [[]];
  let count = 0;
  phrase.words.forEach((word, index) => {
    const line = lines.at(-1);
    if (!line) return;
    const next = count === 0 ? word.text.length : count + 1 + word.text.length;
    if (line.length > 0 && next > maxChars) {
      lines.push([tokens[index] ?? escapeAssText(word.text)]);
      count = word.text.length;
    } else {
      line.push(tokens[index] ?? escapeAssText(word.text));
      count = next;
    }
  });
  return lines.map((line) => line.join(" ")).join("\\N");
}

export type AssDocumentInput = {
  layout: VerticalLayout;
  words: readonly TimedWord[];
  credit: StreamerCredit;
  durationSeconds: number;
  source?: SourceSize;
};

function dialogue(
  start: number,
  end: number,
  style: string,
  text: string,
  anchor: TextAnchor,
  clip: { right: number; bottom: number },
): string {
  if (end <= start || text.trim() === "") return "";
  const body = `${assPositionOverride(anchor, clip)}${text}`;
  return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},${style},,0,0,0,,${body}`;
}

export function buildAssDocument(input: AssDocumentInput): string {
  const duration = Math.max(input.durationSeconds, 0);
  const placement = getTextPlacement({
    layout: input.layout,
    ...(input.source !== undefined ? { source: input.source } : {}),
  });
  const zone = getSafeZone();
  const clip = { right: zone.right, bottom: zone.bottom };
  const events: string[] = [];

  const creditText = escapeAssText(formatStreamerCredit(input.credit));
  if (creditText) {
    events.push(
      dialogue(0, Math.max(duration, 0.05), "Credit", creditText, placement.credit, clip),
    );
  }

  if (input.layout.layout === "blurred-background" && placement.title) {
    const title = escapeAssText(input.layout.hookTitle.trim());
    if (title) {
      events.push(dialogue(0, Math.max(duration, 0.05), "Title", title, placement.title, clip));
    }
  }

  const phrases = groupPhrases(input.words);
  const maxChars = Math.max(
    8,
    Math.floor(placement.caption.maxWidth / (TEXT.captionFontSize * 0.55)),
  );
  for (const phrase of phrases) {
    phrase.words.forEach((word, index) => {
      const next = phrase.words[index + 1];
      const start = word.start;
      const end = next ? Math.max(next.start, word.end) : word.end;
      const text = phraseEventText(phrase, index, maxChars);
      events.push(dialogue(start, end, "Caption", text, placement.caption, clip));
    });
  }

  const header = `[Script Info]
Title: GTA 6 Clipper captions
ScriptType: v4.00+
PlayResX: ${FRAME_WIDTH}
PlayResY: ${FRAME_HEIGHT}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${TEXT.fontName},${TEXT.captionFontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,0,8,0,0,0,1
Style: Title,${TEXT.fontName},${TEXT.titleFontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,0,8,0,0,0,1
Style: Credit,${TEXT.fontName},${TEXT.creditFontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,0,1,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  return `${header}${events.filter(Boolean).join("\n")}\n`;
}

export function defaultFontsDir(): string {
  if (process.platform === "win32") return `${process.env.WINDIR ?? "C:\\Windows"}\\Fonts`;
  return "/usr/share/fonts/truetype/dejavu";
}

// Keep wrapPhrase referenced for tests if needed via export
export { wrapPhrase };
