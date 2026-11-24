import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClipRecord } from "@gta6-clipper/shared";
import { OllamaClient } from "../ai/ollama";
import { buildAssDocument } from "../media/ass";
import { DEFAULT_QA_SETTINGS } from "./config";
import { isQaMigrationMissing, legacyClipRow } from "./db-compat";
import {
  buildGroundingPrompt,
  qaFailureSummary,
  runQaGate,
  statusFromQa,
  type QaClipInput,
  type QaDeps,
} from "./gate";
import { applyQaGate } from "./hook";
import { publishBlockReason } from "./publish-guard";

const transcript =
  "no way he just drove the police car straight off the pier into the ocean chat look at that splash";
const words = transcript
  .split(" ")
  .map((text, i) => ({ text, start: 1 + i * 0.5, end: 1 + i * 0.5 + 0.4 }));
const ass = buildAssDocument({
  layout: { layout: "blurred-background", hookTitle: "POLICE CAR INTO THE OCEAN" },
  words,
  credit: { login: "caseoh_" },
  durationSeconds: 14,
});

const input: QaClipInput = {
  videoPath: "/clips/caseoh_.mp4",
  assContent: ass,
  channelLogin: "caseoh_",
  transcript,
  reasons: ["emote-flood"],
  copy: [
    {
      platform: "youtube",
      title: "CaseOh drives a police car off the pier into the ocean",
      description: "caseoh_ sends the cop car flying off the pier.",
      hookText: "POLICE CAR INTO THE OCEAN",
      source: "llm",
    },
  ],
  credit: "twitch.tv/caseoh_",
};

function deps(overrides: Partial<QaDeps> = {}): QaDeps {
  return {
    settings: DEFAULT_QA_SETTINGS,
    probe: async () => ({ width: 1080, height: 1920, durationSeconds: 14, hasAudio: true }),
    signals: async () => ({
      peakMomentaryLufs: -10,
      medianMomentaryLufs: -28,
      audioSpikeDb: 18,
      maxSceneScore: 0.4,
      meanSceneScore: 0.04,
    }),
    ollama: { generateJson: async () => ({ grounded: true, reason: "matches" }) as never },
    now: () => new Date("2026-11-24T00:00:00.000Z"),
    ...overrides,
  };
}

const offlineOllama = new OllamaClient({
  baseUrl: "http://127.0.0.1:9",
  model: "qwen3:8b",
  fetchImpl: (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch,
});

describe("qa gate", () => {
  it("marks a clip ready when every check passes", async () => {
    const qa = await runQaGate(input, deps());
    assert.deepEqual(qa.failed, []);
    assert.equal(qa.passed, true);
    assert.equal(statusFromQa(qa), "ready");
    assert.deepEqual(
      qa.checks.map((check) => check.id),
      ["highlight", "title", "captions", "format"],
    );
    assert.equal(publishBlockReason({ status: "ready", qa }), undefined);
  });

  it("sends the clip to review when Ollama cannot answer the grounding question", async () => {
    const qa = await runQaGate(input, deps({ ollama: offlineOllama }));
    assert.deepEqual(qa.failed, ["title"]);
    assert.equal(statusFromQa(qa), "review");
    assert.match(qaFailureSummary(qa), /Ollama grounding check unavailable/);
  });

  it("sends template copy, wrong format, and missing captions to review with reasons", async () => {
    let asked = 0;
    const qa = await runQaGate(
      {
        ...input,
        assContent: undefined,
        copy: [
          {
            ...input.copy[0]!,
            source: "template",
            title: "CHAT LOST IT",
            hookText: "CHAT LOST IT",
          },
        ],
      },
      deps({
        probe: async () => ({ width: 1920, height: 1080, durationSeconds: 48, hasAudio: true }),
        ollama: {
          generateJson: async () => {
            asked += 1;
            return undefined;
          },
        },
      }),
    );
    assert.deepEqual(qa.failed, ["title", "captions", "format"]);
    assert.equal(asked, 0, "template copy is not sent to Ollama");
    const summary = qaFailureSummary(qa);
    assert.match(summary, /template fallback/);
    assert.match(summary, /no caption file/);
    assert.match(summary, /outside 12-35 s/);
  });

  it("fails every media check when the file cannot be probed", async () => {
    const qa = await runQaGate(input, deps({ probe: async () => undefined }));
    assert.ok(qa.failed.includes("format"));
    assert.ok(qa.failed.includes("highlight"));
  });

  it("QA_GATE=off keeps clips ready but unpublishable", async () => {
    const qa = await runQaGate(
      input,
      deps({ settings: { ...DEFAULT_QA_SETTINGS, enabled: false } }),
    );
    assert.equal(qa.enabled, false);
    assert.equal(statusFromQa(qa), "ready");
    assert.match(publishBlockReason({ status: "ready", qa }) ?? "", /switched off/);
  });

  it("puts the transcript, title, and hook in the grounding prompt", () => {
    const { system, prompt } = buildGroundingPrompt(input);
    assert.match(system, /JSON only/);
    assert.match(prompt, /TRANSCRIPT: no way he just drove/);
    assert.match(prompt, /HOOK: POLICE CAR INTO THE OCEAN/);
  });
});

describe("qa hook-in", () => {
  const record = (): ClipRecord => ({
    id: "c1",
    momentId: "m1",
    channelLogin: "caseoh_",
    layout: "blurred-background",
    sourcePath: "",
    outputPath: "/clips/caseoh_.mp4",
    posterPath: undefined,
    startedAt: "2026-11-24T00:00:00.000Z",
    durationSeconds: 14,
    hookTitle: "x",
    status: "rendering",
    errorMessage: undefined,
    createdAt: "2026-11-24T00:00:00.000Z",
  });

  it("stores the QA result and sets ready or review", async () => {
    const ready = await applyQaGate(record(), input, (i) => runQaGate(i, deps()));
    assert.equal(ready.status, "ready");
    assert.equal(ready.qa?.passed, true);
    assert.equal(ready.errorMessage, undefined);
    const review = await applyQaGate(record(), input, (i) =>
      runQaGate(i, deps({ ollama: offlineOllama })),
    );
    assert.equal(review.status, "review");
    assert.match(review.errorMessage ?? "", /^QA review: title:/);
  });
});

describe("qa supabase compatibility", () => {
  it("detects a missing migration and downgrades review rows to failed", () => {
    assert.equal(
      isQaMigrationMissing({
        code: "PGRST204",
        message: "Could not find the 'qa' column of 'clips'",
      }),
      true,
    );
    assert.equal(
      isQaMigrationMissing({
        code: "23514",
        message: 'violates check constraint "clips_status_check"',
      }),
      true,
    );
    assert.equal(isQaMigrationMissing({ code: "23505", message: "duplicate" }), false);
    const row = legacyClipRow({
      id: "c1",
      status: "review",
      error_message: "QA review: title: x",
      qa: {},
    });
    assert.deepEqual(row, { id: "c1", status: "failed", error_message: "QA review: title: x" });
    assert.deepEqual(legacyClipRow({ status: "ready", error_message: null, qa: {} }), {
      status: "ready",
      error_message: null,
    });
  });
});
