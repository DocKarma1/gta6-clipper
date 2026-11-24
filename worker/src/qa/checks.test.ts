import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAssDocument } from "../media/ass";
import { assPlainLines, captionCues, parseAss, parseAssTime } from "./ass-parse";
import { checkCaptions, checkFormat, checkHighlight, checkTitle, type QaCopy } from "./checks";
import { DEFAULT_QA_SETTINGS, getQaSettings } from "./config";
import { keywordOverlap, loginKey, meaningfulWords, titleKeywords } from "./text";

const s = DEFAULT_QA_SETTINGS;
const transcript =
  "no way he just drove the police car straight off the pier into the ocean chat look at that splash";
const words = transcript
  .split(" ")
  .map((text, i) => ({ text, start: 1 + i * 0.5, end: 1 + i * 0.5 + 0.4 }));
const llmCopy: QaCopy[] = [
  {
    platform: "youtube",
    title: "CaseOh drives a police car off the pier into the ocean",
    description: "caseoh_ sends the cop car flying off the pier.",
    hookText: "POLICE CAR INTO THE OCEAN",
    source: "llm",
  },
];
const goodSignals = {
  peakMomentaryLufs: -10,
  medianMomentaryLufs: -30,
  audioSpikeDb: 20,
  maxSceneScore: 0.5,
  meanSceneScore: 0.05,
};

describe("qa settings", () => {
  it("has defaults and reads overrides, ignoring invalid values", () => {
    assert.equal(getQaSettings({}).enabled, true);
    const custom = getQaSettings({
      QA_GATE: "off",
      QA_MIN_SECONDS: "10",
      QA_MIN_AUDIO_SPIKE_DB: "nope",
      QA_HIGHLIGHT_MIN_SIGNALS: "9",
    });
    assert.equal(custom.enabled, false);
    assert.equal(custom.minSeconds, 10);
    assert.equal(custom.minAudioSpikeDb, s.minAudioSpikeDb);
    assert.equal(custom.highlightMinSignals, s.highlightMinSignals);
  });
});

describe("qa text helpers", () => {
  it("drops filler and generic title words", () => {
    assert.deepEqual(meaningfulWords("uh yeah bro the police car"), ["police", "car"]);
    assert.deepEqual(titleKeywords("CHAT LOST IT", []), []);
    assert.deepEqual(titleKeywords("caseoh_ GTA 6 police chase", ["caseoh_"]), ["police", "chase"]);
  });

  it("matches keywords by stem and prefix", () => {
    const result = keywordOverlap(["exploded", "cars", "dragon"], "the car explodes");
    assert.deepEqual(result.matched, ["exploded", "cars"]);
    assert.deepEqual(result.missing, ["dragon"]);
    assert.equal(loginKey("CaseOh"), loginKey("caseoh_"));
  });
});

describe("ass parsing", () => {
  it("reads times, positions, styles, and phrase cues from the renderer's output", () => {
    assert.equal(parseAssTime("0:00:01.50"), 1.5);
    assert.deepEqual(assPlainLines("{\\an8}hi \\{x\\}\\Nthere"), ["hi {x}", "there"]);
    const doc = parseAss(
      buildAssDocument({
        layout: { layout: "blurred-background", hookTitle: "POLICE CAR" },
        words,
        credit: { login: "caseoh_" },
        durationSeconds: 14,
      }),
    );
    assert.equal(doc.playResY, 1920);
    assert.equal(doc.fontSizes.Caption, 84);
    assert.ok(doc.events.some((e) => e.style === "Credit" && e.lines[0] === "twitch.tv/caseoh_"));
    const cues = captionCues(doc);
    assert.equal(cues.length, Math.ceil(words.length / 6));
    assert.ok(cues.every((cue) => cue.end > cue.start));
  });
});

describe("qa checks", () => {
  it("format: 1080x1920 within 12-35 s passes; wrong size or length fails", () => {
    assert.equal(
      checkFormat({ width: 1080, height: 1920, durationSeconds: 20, hasAudio: true }, s).passed,
      true,
    );
    const bad = checkFormat({ width: 1920, height: 1080, durationSeconds: 40, hasAudio: true }, s);
    assert.equal(bad.passed, false);
    assert.equal(bad.reasons.length, 3);
    assert.equal(checkFormat(undefined, s).passed, false);
  });

  it("highlight: needs two of speech, audio spike, and visual change", () => {
    const pass = checkHighlight({ transcript, durationSeconds: 14, signals: goodSignals }, s);
    assert.equal(pass.passed, true);
    assert.equal(pass.metrics.signals, 3);
    // Chat spam over a quiet, static stream: no speech, flat audio, no motion.
    const spam = checkHighlight(
      {
        transcript: "uh yeah",
        durationSeconds: 14,
        signals: { ...goodSignals, audioSpikeDb: 1.5, maxSceneScore: 0.01, meanSceneScore: 0.001 },
      },
      s,
    );
    assert.equal(spam.passed, false);
    assert.match(spam.reasons[0] ?? "", /0 of 3 signals/);
    const unmeasured = checkHighlight(
      {
        transcript,
        durationSeconds: 14,
        signals: {
          peakMomentaryLufs: undefined,
          medianMomentaryLufs: undefined,
          audioSpikeDb: undefined,
          maxSceneScore: undefined,
          meanSceneScore: undefined,
        },
      },
      s,
    );
    assert.equal(unmeasured.passed, false);
    assert.equal(
      checkHighlight(
        { transcript, durationSeconds: 14, signals: goodSignals },
        { ...s, highlightMinSignals: 1 },
      ).passed,
      true,
    );
  });

  it("title: rejects template copy, ungrounded titles, and failed or missing Ollama checks", () => {
    const base = {
      copy: llmCopy,
      transcript,
      channelLogin: "caseoh_",
      verdict: { status: "skipped" as const },
    };
    assert.equal(checkTitle(base, s).passed, true);
    const template = checkTitle(
      {
        ...base,
        copy: [
          { ...llmCopy[0]!, title: "CHAT LOST IT", hookText: "CHAT LOST IT", source: "template" },
        ],
      },
      s,
    );
    assert.equal(template.passed, false);
    assert.match(template.reasons.join(" "), /template fallback/);
    assert.match(template.reasons.join(" "), /no clip-specific words/);
    const invented = checkTitle(
      {
        ...base,
        copy: [
          {
            ...llmCopy[0]!,
            title: "CaseOh finds a secret dragon in the mountains",
            hookText: "SECRET DRAGON",
          },
        ],
      },
      s,
    );
    assert.equal(invented.passed, false);
    assert.match(invented.reasons[0] ?? "", /not grounded/);
    assert.equal(checkTitle({ ...base, verdict: { status: "unavailable" } }, s).passed, false);
    const no = checkTitle(
      { ...base, verdict: { status: "answered", grounded: false, reason: "no pier" } },
      s,
    );
    assert.match(no.reasons.join(" "), /no pier/);
    assert.equal(
      checkTitle({ ...base, verdict: { status: "answered", grounded: true, reason: "ok" } }, s)
        .passed,
      true,
    );
  });

  it("captions: readable cues inside safe areas with the right credit", () => {
    const doc = parseAss(
      buildAssDocument({
        layout: { layout: "blurred-background", hookTitle: "POLICE CAR" },
        words,
        credit: { login: "caseoh_" },
        durationSeconds: 14,
      }),
    );
    const input = {
      doc,
      channelLogin: "caseoh_",
      copy: llmCopy,
      credit: "twitch.tv/caseoh_",
      durationSeconds: 14,
    };
    const ok = checkCaptions(input, s);
    assert.deepEqual(ok.reasons, []);
    const wrongCredit = checkCaptions(
      { ...input, channelLogin: "illojuan", copy: llmCopy, credit: undefined },
      s,
    );
    assert.equal(wrongCredit.passed, false);
    assert.match(wrongCredit.reasons.join(" "), /does not match/);
    assert.match(wrongCredit.reasons.join(" "), /does not name the streamer/);
    assert.equal(checkCaptions({ ...input, doc: undefined }, s).passed, false);
    const empty = parseAss(
      buildAssDocument({
        layout: { layout: "blurred-background", hookTitle: "" },
        words: [],
        credit: { login: "caseoh_" },
        durationSeconds: 14,
      }),
    );
    assert.match(checkCaptions({ ...input, doc: empty }, s).reasons.join(" "), /0 caption cues/);
  });

  it("captions: flags text outside the safe area and over-long lines", () => {
    const content = [
      "[Script Info]",
      "PlayResX: 1080",
      "PlayResY: 1920",
      "[V4+ Styles]",
      "Style: Caption,DejaVu Sans,84,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,0,8,0,0,0,1",
      "Style: Credit,DejaVu Sans,36,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,0,1,0,0,0,1",
      "[Events]",
      "Dialogue: 0,0:00:01.00,0:00:03.00,Caption,,0,0,0,,{\\an8\\pos(540,1800)}this caption sits under the platform buttons",
      "Dialogue: 0,0:00:03.00,0:00:05.00,Caption,,0,0,0,,{\\an8\\pos(475,600)}short one",
      "Dialogue: 0,0:00:00.00,0:00:14.00,Credit,,0,0,0,,{\\an1\\pos(48,1584)}twitch.tv/caseoh_",
    ].join("\n");
    const result = checkCaptions(
      { doc: parseAss(content), channelLogin: "caseoh_", copy: llmCopy, durationSeconds: 14 },
      s,
    );
    assert.equal(result.passed, false);
    assert.match(result.reasons.join(" "), /outside the safe area: Caption/);
    assert.match(result.reasons.join(" "), /lines over 32 chars/);
  });
});
