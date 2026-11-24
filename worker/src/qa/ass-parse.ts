/** Minimal reader for the ASS files the renderer writes (see media/ass.ts). */

export type AssEvent = {
  start: number;
  end: number;
  style: string;
  /** Plain text lines (override tags removed, \N split). */
  lines: string[];
  /** \an alignment (1-9); 7 when absent. */
  align: number;
  /** \pos(x,y); undefined when absent. */
  pos: { x: number; y: number } | undefined;
};

export type AssDocument = {
  playResX: number;
  playResY: number;
  fontSizes: Record<string, number>;
  events: AssEvent[];
};

export function parseAssTime(value: string): number {
  const match = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/u.exec(value.trim());
  if (!match) return NaN;
  const frac = match[4] ? Number(`0.${match[4]}`) : 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + frac;
}

/** Strip override blocks and unescape, keeping literal \{ \} \\ from escapeAssText. */
export function assPlainLines(text: string): string[] {
  const OPEN = "\u0001";
  const CLOSE = "\u0002";
  const SLASH = "\u0003";
  const plain = text
    .replaceAll("\\\\", SLASH)
    .replaceAll("\\{", OPEN)
    .replaceAll("\\}", CLOSE)
    .replace(/\{[^}]*\}/gu, "");
  return plain
    .split(/\\N|\\n/u)
    .map((line) =>
      line
        .replaceAll(OPEN, "{")
        .replaceAll(CLOSE, "}")
        .replaceAll(SLASH, "\\")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

export function parseAss(content: string): AssDocument {
  const doc: AssDocument = { playResX: 1080, playResY: 1920, fontSizes: {}, events: [] };
  for (const raw of content.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith("PlayResX:")) doc.playResX = Number(line.slice(9)) || doc.playResX;
    else if (line.startsWith("PlayResY:")) doc.playResY = Number(line.slice(9)) || doc.playResY;
    else if (line.startsWith("Style:")) {
      const fields = line.slice(6).split(",");
      const name = fields[0]?.trim();
      const size = Number(fields[2]);
      if (name && Number.isFinite(size)) doc.fontSizes[name] = size;
    } else if (line.startsWith("Dialogue:")) {
      // Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      const fields = line.slice(9).split(",");
      if (fields.length < 10) continue;
      const text = fields.slice(9).join(",");
      const an = /\\an(\d)/u.exec(text);
      const pos = /\\pos\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/u.exec(text);
      doc.events.push({
        start: parseAssTime(fields[1] ?? ""),
        end: parseAssTime(fields[2] ?? ""),
        style: (fields[3] ?? "").trim(),
        lines: assPlainLines(text),
        align: an ? Number(an[1]) : 7,
        pos: pos ? { x: Number(pos[1]), y: Number(pos[2]) } : undefined,
      });
    }
  }
  return doc;
}

/**
 * Estimated on-screen box for an event: width from the longest line at
 * ~0.55 em per character (same ratio the renderer wraps with), height from
 * line count at 1.2 em.
 */
export function estimateEventBox(
  event: AssEvent,
  fontSize: number,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!event.pos) return undefined;
  const longest = Math.max(0, ...event.lines.map((line) => line.length));
  const width = longest * fontSize * 0.55;
  const height = Math.max(1, event.lines.length) * fontSize * 1.2;
  const col = (event.align - 1) % 3; // 0 left, 1 center, 2 right
  const row = event.align >= 7 ? "top" : event.align >= 4 ? "middle" : "bottom";
  const x = col === 0 ? event.pos.x : col === 1 ? event.pos.x - width / 2 : event.pos.x - width;
  const y =
    row === "top"
      ? event.pos.y
      : row === "middle"
        ? event.pos.y - height / 2
        : event.pos.y - height;
  return { x, y, width, height };
}

export type CaptionCue = { start: number; end: number; lines: string[] };

/**
 * The renderer writes one event per highlighted word with the whole phrase
 * as text; merge adjacent caption events with identical text into one cue.
 */
export function captionCues(doc: AssDocument, style = "Caption"): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const events = doc.events
    .filter((event) => event.style === style && event.lines.length > 0)
    .sort((a, b) => a.start - b.start);
  for (const event of events) {
    const last = cues.at(-1);
    const sameText = last && last.lines.join("\n") === event.lines.join("\n");
    if (last && sameText && event.start - last.end <= 0.05) {
      last.end = Math.max(last.end, event.end);
    } else {
      cues.push({ start: event.start, end: event.end, lines: [...event.lines] });
    }
  }
  return cues;
}
