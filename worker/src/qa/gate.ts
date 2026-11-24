import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getLogger, getOllamaSettings, type ClipQaSummary } from "@gta6-clipper/shared";
import { OllamaClient } from "../ai/ollama";
import { parseAss, type AssDocument } from "./ass-parse";
import {
  checkCaptions,
  checkFormat,
  checkHighlight,
  checkTitle,
  type GroundingVerdict,
  type QaCopy,
} from "./checks";
import { getQaSettings, type QaSettings } from "./config";
import { measureSignals, probeFormat, type MediaFormat, type MediaSignals } from "./media";

const log = getLogger("worker.qa");

export type QaClipInput = {
  videoPath: string;
  /** Burned-in caption file the renderer wrote; read when assContent is not given. */
  assPath?: string | undefined;
  assContent?: string | undefined;
  channelLogin: string;
  /** Transcript of the trimmed clip window. */
  transcript: string;
  reasons: string[];
  questionText?: string | undefined;
  copy: QaCopy[];
  /** Sidecar credit line, e.g. "twitch.tv/ohnepixel". */
  credit?: string | undefined;
};

/** Anything with OllamaClient.generateJson's shape (tests pass a fake). */
export type GroundingClient = Pick<OllamaClient, "generateJson">;

export type QaDeps = {
  settings?: QaSettings;
  probe?: (filePath: string) => Promise<MediaFormat | undefined>;
  signals?: (filePath: string, hasAudio: boolean) => Promise<MediaSignals>;
  readText?: (filePath: string) => Promise<string>;
  /** Ollama client for the grounding question; defaults to OLLAMA_URL / OLLAMA_MODEL. */
  ollama?: GroundingClient;
  now?: () => Date;
};

export type QaStatus = "ready" | "review";

const groundingSchema = z.object({
  grounded: z.boolean(),
  reason: z.string().trim().max(400).default(""),
});

export function buildGroundingPrompt(input: QaClipInput): { system: string; prompt: string } {
  const primary = input.copy[0];
  return {
    system: [
      "You are a strict fact-checker for short gaming clip titles.",
      "Decide if the TITLE and HOOK only describe things supported by the TRANSCRIPT and chat reaction.",
      "Exaggerated tone is fine; invented events, people, items, or outcomes are not.",
      'Answer with JSON only: {"grounded": true|false, "reason": "one short sentence"}.',
    ].join("\n"),
    prompt: [
      `Streamer: ${input.channelLogin}`,
      `Why chat reacted: ${input.reasons.join(", ") || "hype"}`,
      ...(input.questionText ? [`Question the streamer asked: ${input.questionText}`] : []),
      `TRANSCRIPT: ${input.transcript.slice(0, 900) || "(none)"}`,
      `TITLE: ${primary?.title ?? ""}`,
      `HOOK: ${primary?.hookText ?? ""}`,
    ].join("\n"),
  };
}

let sharedClient: OllamaClient | undefined;
function defaultOllama(): OllamaClient {
  if (!sharedClient) {
    const settings = getOllamaSettings();
    sharedClient = new OllamaClient({
      baseUrl: settings.url,
      model: settings.model,
      timeoutMs: settings.timeoutMs,
      retries: 1,
    });
  }
  return sharedClient;
}

export async function askGrounding(
  input: QaClipInput,
  client: GroundingClient,
): Promise<GroundingVerdict> {
  const { system, prompt } = buildGroundingPrompt(input);
  const answer = await client.generateJson(groundingSchema, { system, prompt, temperature: 0 });
  if (!answer) return { status: "unavailable" };
  return { status: "answered", grounded: answer.grounded, reason: answer.reason ?? "" };
}

/**
 * Run all four checks. Never throws: a check that cannot run (missing file,
 * ffmpeg error, Ollama down) fails, so the clip goes to review instead of ready.
 */
export async function runQaGate(input: QaClipInput, deps: QaDeps = {}): Promise<ClipQaSummary> {
  const settings = deps.settings ?? getQaSettings();
  const now = (deps.now ?? (() => new Date()))().toISOString();
  if (!settings.enabled) {
    return { version: 1, enabled: false, passed: false, checkedAt: now, checks: [], failed: [] };
  }
  const probe = deps.probe ?? probeFormat;
  const signals = deps.signals ?? measureSignals;
  const readText = deps.readText ?? ((filePath: string) => readFile(filePath, "utf8"));

  const format = await probe(input.videoPath).catch(() => undefined);
  const media: MediaSignals = format
    ? await signals(input.videoPath, format.hasAudio).catch(() => ({
        peakMomentaryLufs: undefined,
        medianMomentaryLufs: undefined,
        audioSpikeDb: undefined,
        maxSceneScore: undefined,
        meanSceneScore: undefined,
      }))
    : {
        peakMomentaryLufs: undefined,
        medianMomentaryLufs: undefined,
        audioSpikeDb: undefined,
        maxSceneScore: undefined,
        meanSceneScore: undefined,
      };

  let doc: AssDocument | undefined;
  const assText =
    input.assContent ??
    (input.assPath ? await readText(input.assPath).catch(() => undefined) : undefined);
  if (assText) doc = parseAss(assText);

  const hasLlmCopy = input.copy.length > 0 && input.copy.every((pack) => pack.source === "llm");
  let verdict: GroundingVerdict = { status: "skipped" };
  // Template copy already fails; only spend an LLM call on AI-written copy.
  if (settings.ollamaGroundingCheck && hasLlmCopy && input.transcript.trim()) {
    try {
      verdict = await askGrounding(input, deps.ollama ?? defaultOllama());
    } catch {
      verdict = { status: "unavailable" };
    }
  }

  const durationSeconds = format?.durationSeconds;
  const checks = [
    checkHighlight({ transcript: input.transcript, durationSeconds, signals: media }, settings),
    checkTitle(
      {
        copy: input.copy,
        transcript: input.transcript,
        questionText: input.questionText,
        channelLogin: input.channelLogin,
        verdict,
      },
      settings,
    ),
    checkCaptions(
      {
        doc,
        channelLogin: input.channelLogin,
        copy: input.copy,
        credit: input.credit,
        durationSeconds,
      },
      settings,
    ),
    checkFormat(format, settings),
  ];
  const failed = checks.filter((check) => !check.passed).map((check) => check.id);
  const summary: ClipQaSummary = {
    version: 1,
    enabled: true,
    passed: failed.length === 0,
    checkedAt: now,
    checks,
    failed,
  };
  if (failed.length) {
    log.info({ channel: input.channelLogin, failed }, "QA gate sent a clip to review");
  }
  return summary;
}

/** "ready" only when the gate ran and every check passed (or the gate is switched off). */
export function statusFromQa(qa: ClipQaSummary): QaStatus {
  if (!qa.enabled) return "ready";
  return qa.passed ? "ready" : "review";
}

/** Short text for error_message / logs: "title: template fallback…; format: …". */
export function qaFailureSummary(qa: ClipQaSummary, max = 500): string {
  const text = qa.checks
    .filter((check) => !check.passed)
    .map((check) => `${check.id}: ${check.reasons.join("; ")}`)
    .join(" | ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
