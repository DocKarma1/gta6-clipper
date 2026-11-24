import { getSafeZone, type ClipQaCheck } from "@gta6-clipper/shared";
import { captionCues, estimateEventBox, type AssDocument } from "./ass-parse";
import type { QaSettings } from "./config";
import type { MediaFormat, MediaSignals } from "./media";
import { keywordOverlap, loginKey, meaningfulWords, titleKeywords, tokenize } from "./text";

export type QaCopy = {
  platform: string;
  title: string;
  description: string;
  hookText: string;
  hashtags?: string[];
  source: "llm" | "template" | string;
};

/** Result of the optional Ollama yes/no grounding question. */
export type GroundingVerdict =
  | { status: "skipped" }
  | { status: "unavailable" }
  | { status: "answered"; grounded: boolean; reason: string };

const round = (value: number | undefined, digits = 2): number | null =>
  value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(digits));

function result(
  id: ClipQaCheck["id"],
  reasons: string[],
  metrics: ClipQaCheck["metrics"],
): ClipQaCheck {
  return { id, passed: reasons.length === 0, reasons, metrics };
}

/** 4. Duration and 1080x1920 vertical frame. */
export function checkFormat(format: MediaFormat | undefined, s: QaSettings): ClipQaCheck {
  if (!format) {
    return result("format", ["ffprobe could not read the clip (missing or broken file)"], {});
  }
  const reasons: string[] = [];
  const d = format.durationSeconds;
  if (!Number.isFinite(d)) reasons.push("duration is unknown");
  else if (d < s.minSeconds - 0.05 || d > s.maxSeconds + 0.05) {
    reasons.push(`duration ${d.toFixed(1)} s is outside ${s.minSeconds}-${s.maxSeconds} s`);
  }
  if (format.width !== s.width || format.height !== s.height) {
    reasons.push(`resolution ${format.width}x${format.height}, expected ${s.width}x${s.height}`);
  }
  if (format.height <= format.width) reasons.push("frame is not vertical");
  return result("format", reasons, {
    width: format.width,
    height: format.height,
    durationSeconds: round(d),
    hasAudio: format.hasAudio,
  });
}

/** 1. A real spoken or visual moment, not just chat spam. */
export function checkHighlight(
  input: { transcript: string; durationSeconds: number | undefined; signals: MediaSignals },
  s: QaSettings,
): ClipQaCheck {
  const meaningful = meaningfulWords(input.transcript).length;
  const totalWords = tokenize(input.transcript).length;
  const duration =
    input.durationSeconds && input.durationSeconds > 0 ? input.durationSeconds : undefined;
  const wps = duration ? totalWords / duration : 0;
  const speech = meaningful >= s.minMeaningfulWords && wps >= s.minSpeechWordsPerSecond;
  const spike = input.signals.audioSpikeDb;
  const audio = spike !== undefined && spike >= s.minAudioSpikeDb;
  const maxScene = input.signals.maxSceneScore;
  const meanScene = input.signals.meanSceneScore;
  const visual =
    (maxScene !== undefined && maxScene >= s.minSceneScore) ||
    (meanScene !== undefined && meanScene >= s.minMotionScore);
  const fired = [speech, audio, visual].filter(Boolean).length;
  const reasons: string[] = [];
  if (fired < s.highlightMinSignals) {
    const details: string[] = [];
    if (!speech) {
      details.push(
        `speech: ${meaningful} meaningful words, ${wps.toFixed(2)} words/s (need ${s.minMeaningfulWords} and ${s.minSpeechWordsPerSecond})`,
      );
    }
    if (!audio) {
      details.push(
        spike === undefined
          ? "audio: loudness could not be measured"
          : `audio: loudness spike ${spike.toFixed(1)} dB (need ${s.minAudioSpikeDb})`,
      );
    }
    if (!visual) {
      details.push(
        maxScene === undefined
          ? "visual: scene/motion could not be measured"
          : `visual: max scene ${maxScene.toFixed(3)} (need ${s.minSceneScore}), motion ${(meanScene ?? 0).toFixed(3)} (need ${s.minMotionScore})`,
      );
    }
    reasons.push(
      `no clear highlight: ${fired} of 3 signals (need ${s.highlightMinSignals}); ${details.join("; ")}`,
    );
  }
  return result("highlight", reasons, {
    signals: fired,
    speech,
    audio,
    visual,
    meaningfulWords: meaningful,
    wordsPerSecond: round(wps),
    audioSpikeDb: round(spike),
    peakMomentaryLufs: round(input.signals.peakMomentaryLufs, 1),
    medianMomentaryLufs: round(input.signals.medianMomentaryLufs, 1),
    maxSceneScore: round(maxScene, 4),
    meanSceneScore: round(meanScene, 4),
  });
}

/** 2. AI-written (not template) title and hook that are grounded in the transcript. */
export function checkTitle(
  input: {
    copy: QaCopy[];
    transcript: string;
    questionText?: string | undefined;
    channelLogin: string;
    verdict: GroundingVerdict;
  },
  s: QaSettings,
): ClipQaCheck {
  const primary = input.copy[0];
  if (!primary) return result("title", ["no title copy was written"], {});
  const reasons: string[] = [];
  const templates = input.copy.filter((pack) => pack.source !== "llm");
  if (templates.length > 0) {
    reasons.push(
      `template fallback copy on ${templates.map((p) => p.platform).join(", ")} (Ollama did not write it)`,
    );
  }
  const grounding = [input.transcript, input.questionText ?? ""].join(" ");
  const keywords = titleKeywords(`${primary.title} ${primary.hookText}`, [input.channelLogin]);
  const overlap = keywordOverlap(keywords, grounding);
  if (!input.transcript.trim()) {
    reasons.push("no transcript to ground the title in");
  } else if (keywords.length === 0) {
    reasons.push("title and hook have no clip-specific words");
  } else if (overlap.ratio < s.minTitleOverlap) {
    reasons.push(
      `title/hook not grounded in transcript: ${Math.round(overlap.ratio * 100)}% keyword overlap (need ${Math.round(s.minTitleOverlap * 100)}%); unmatched: ${overlap.missing.slice(0, 6).join(", ")}`,
    );
  }
  if (input.verdict.status === "unavailable") {
    reasons.push("Ollama grounding check unavailable (server down, slow, or bad JSON)");
  } else if (input.verdict.status === "answered" && !input.verdict.grounded) {
    reasons.push(`Ollama says the title is not accurate: ${input.verdict.reason || "no reason"}`);
  }
  return result("title", reasons, {
    title: primary.title,
    hook: primary.hookText,
    source: primary.source,
    keywordCount: keywords.length,
    keywordOverlap: round(overlap.ratio),
    matched: overlap.matched.join(", "),
    ollama:
      input.verdict.status === "answered"
        ? input.verdict.grounded
          ? "grounded"
          : "not grounded"
        : input.verdict.status,
    ollamaReason: input.verdict.status === "answered" ? input.verdict.reason : null,
  });
}

/** 3. Burned-in captions exist and are readable, inside safe areas; credit is right. */
export function checkCaptions(
  input: {
    doc: AssDocument | undefined;
    channelLogin: string;
    copy: QaCopy[];
    credit?: string | undefined;
    durationSeconds: number | undefined;
  },
  s: QaSettings,
): ClipQaCheck {
  const reasons: string[] = [];
  const login = loginKey(input.channelLogin);
  if (!input.doc) {
    reasons.push("no caption file (.ass) next to the clip");
  }
  const doc = input.doc;
  const cues = doc ? captionCues(doc) : [];
  let longLines = 0;
  let tooManyLines = 0;
  let badTiming = 0;
  let tooFast = 0;
  let afterEnd = 0;
  for (const cue of cues) {
    const seconds = cue.end - cue.start;
    const chars = cue.lines.join(" ").length;
    if (cue.lines.some((line) => line.length > s.maxCaptionLineChars)) longLines += 1;
    if (cue.lines.length > s.maxCaptionLines) tooManyLines += 1;
    if (!(seconds >= s.minCueSeconds && seconds <= s.maxCueSeconds)) badTiming += 1;
    else if (chars / seconds > s.maxCaptionCps) tooFast += 1;
    if (input.durationSeconds && cue.end > input.durationSeconds + 0.5) afterEnd += 1;
  }
  if (doc && cues.length < s.minCaptionCues) {
    reasons.push(`${cues.length} caption cues (need at least ${s.minCaptionCues})`);
  }
  if (longLines)
    reasons.push(`${longLines} caption cue(s) with lines over ${s.maxCaptionLineChars} chars`);
  if (tooManyLines)
    reasons.push(`${tooManyLines} caption cue(s) with more than ${s.maxCaptionLines} lines`);
  // Whisper word timing is noisy; tolerate up to a quarter of cues off on timing.
  const timingIssues = badTiming + tooFast;
  if (cues.length && timingIssues / cues.length > 0.25) {
    reasons.push(
      `${timingIssues} of ${cues.length} caption cues too short/long (${s.minCueSeconds}-${s.maxCueSeconds} s) or faster than ${s.maxCaptionCps} chars/s`,
    );
  }
  if (afterEnd) reasons.push(`${afterEnd} caption cue(s) run past the end of the clip`);

  // Safe areas (platform UI on the right and bottom).
  const outside = new Set<string>();
  if (doc) {
    const zone = getSafeZone({ width: doc.playResX, height: doc.playResY });
    for (const event of doc.events) {
      const box = estimateEventBox(event, doc.fontSizes[event.style] ?? 48);
      if (!box) continue;
      const tolerance = 2;
      if (
        box.x < zone.left - tolerance ||
        box.y < zone.top - tolerance ||
        box.x + box.width > zone.right + tolerance ||
        box.y + box.height > zone.bottom + tolerance
      ) {
        outside.add(event.style);
      }
    }
    if (outside.size) {
      reasons.push(`text outside the safe area: ${[...outside].join(", ")}`);
    }
  }

  // Streamer credit: burned in, plus in the description or sidecar credit.
  const creditTexts = doc
    ? doc.events.filter((event) => event.style === "Credit").map((event) => event.lines.join(" "))
    : [];
  const burnedCredit = creditTexts.find((text) => /twitch\.tv\/|^@/iu.test(text));
  const burnedOk = Boolean(burnedCredit && loginKey(burnedCredit).includes(login) && login);
  if (doc && !burnedOk) {
    reasons.push(
      burnedCredit
        ? `burned-in credit "${burnedCredit}" does not match twitch.tv/${input.channelLogin}`
        : "no burned-in streamer credit",
    );
  }
  const descriptionOk = input.copy.some((pack) => loginKey(pack.description).includes(login));
  const sidecarCreditOk = Boolean(input.credit && loginKey(input.credit).includes(login));
  if (!login || !(descriptionOk || sidecarCreditOk)) {
    reasons.push(`description/credit does not name the streamer (${input.channelLogin})`);
  }

  return result("captions", reasons, {
    cues: cues.length,
    longLines,
    tooManyLines,
    badTiming,
    tooFast,
    afterEnd,
    outsideSafeArea: [...outside].join(", ") || null,
    burnedCredit: burnedCredit ?? null,
    descriptionCredit: descriptionOk,
  });
}
