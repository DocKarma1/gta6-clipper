/**
 * QA gate settings. Read straight from process.env (after the repo .env is
 * loaded by the caller) so the gate stays self-contained. Every threshold has
 * a default; invalid values fall back to the default instead of throwing.
 */
export type QaSettings = {
  /** QA_GATE=off restores the old behaviour (clips go straight to "ready", unpublishable). */
  enabled: boolean;

  // 1. Highlight
  /** Meaningful (non-filler) transcript words needed to count speech as a signal. */
  minMeaningfulWords: number;
  /** Words per second over the clip needed to count speech as a signal. */
  minSpeechWordsPerSecond: number;
  /** Momentary-loudness peak above the clip median (dB / LU) for an audio spike. */
  minAudioSpikeDb: number;
  /** Highest ffmpeg scene score (0-1) that counts as a visual moment. */
  minSceneScore: number;
  /** Mean frame-to-frame scene score (0-1) that counts as sustained motion. */
  minMotionScore: number;
  /** How many of the three signals (speech, audio spike, visual) must fire. */
  highlightMinSignals: number;

  // 2. Title
  /** Share of the title/hook keywords that must appear in the transcript. */
  minTitleOverlap: number;
  /** Ask Ollama whether the title is grounded; unreachable Ollama => review. */
  ollamaGroundingCheck: boolean;

  // 3. Captions
  minCaptionCues: number;
  maxCaptionLineChars: number;
  maxCaptionLines: number;
  minCueSeconds: number;
  maxCueSeconds: number;
  /** Reading speed ceiling (characters per second) per caption cue. */
  maxCaptionCps: number;

  // 4. Format
  minSeconds: number;
  maxSeconds: number;
  width: number;
  height: number;
};

export const DEFAULT_QA_SETTINGS: QaSettings = {
  enabled: true,
  minMeaningfulWords: 5,
  minSpeechWordsPerSecond: 0.6,
  minAudioSpikeDb: 6,
  minSceneScore: 0.3,
  minMotionScore: 0.02,
  highlightMinSignals: 2,
  minTitleOverlap: 0.3,
  ollamaGroundingCheck: true,
  minCaptionCues: 2,
  maxCaptionLineChars: 32,
  maxCaptionLines: 2,
  minCueSeconds: 0.3,
  maxCueSeconds: 7,
  maxCaptionCps: 25,
  minSeconds: 12,
  maxSeconds: 35,
  width: 1080,
  height: 1920,
};

type Env = Record<string, string | undefined>;

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return fallback;
}

function num(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function getQaSettings(env: Env = process.env): QaSettings {
  const d = DEFAULT_QA_SETTINGS;
  return {
    enabled: bool(env.QA_GATE, d.enabled),
    minMeaningfulWords: num(env.QA_MIN_MEANINGFUL_WORDS, d.minMeaningfulWords, 0, 500),
    minSpeechWordsPerSecond: num(env.QA_MIN_SPEECH_WPS, d.minSpeechWordsPerSecond, 0, 10),
    minAudioSpikeDb: num(env.QA_MIN_AUDIO_SPIKE_DB, d.minAudioSpikeDb, 0, 60),
    minSceneScore: num(env.QA_MIN_SCENE_SCORE, d.minSceneScore, 0, 1),
    minMotionScore: num(env.QA_MIN_MOTION_SCORE, d.minMotionScore, 0, 1),
    highlightMinSignals: Math.round(num(env.QA_HIGHLIGHT_MIN_SIGNALS, d.highlightMinSignals, 1, 3)),
    minTitleOverlap: num(env.QA_MIN_TITLE_OVERLAP, d.minTitleOverlap, 0, 1),
    ollamaGroundingCheck: bool(env.QA_OLLAMA_CHECK, d.ollamaGroundingCheck),
    minCaptionCues: Math.round(num(env.QA_MIN_CAPTION_CUES, d.minCaptionCues, 0, 500)),
    maxCaptionLineChars: Math.round(
      num(env.QA_MAX_CAPTION_LINE_CHARS, d.maxCaptionLineChars, 8, 200),
    ),
    maxCaptionLines: Math.round(num(env.QA_MAX_CAPTION_LINES, d.maxCaptionLines, 1, 10)),
    minCueSeconds: num(env.QA_MIN_CUE_SECONDS, d.minCueSeconds, 0, 10),
    maxCueSeconds: num(env.QA_MAX_CUE_SECONDS, d.maxCueSeconds, 0.5, 60),
    maxCaptionCps: num(env.QA_MAX_CAPTION_CPS, d.maxCaptionCps, 1, 100),
    minSeconds: num(env.QA_MIN_SECONDS, d.minSeconds, 0, 600),
    maxSeconds: num(env.QA_MAX_SECONDS, d.maxSeconds, 1, 600),
    width: Math.round(num(env.QA_WIDTH, d.width, 16, 8192)),
    height: Math.round(num(env.QA_HEIGHT, d.height, 16, 8192)),
  };
}
