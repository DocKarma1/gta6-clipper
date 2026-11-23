import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ChatEvent } from "@gta6-clipper/shared";
import { QuestionReplyDetector, findSpokenQuestions, isBroadcasterQuestion } from "./question";

/**
 * Reference: the ohnePixel clip sent to the owner. The streamer asks
 * "Did you ever subscribe to something or no?" and chat floods with replies
 * (stored moment: 16 msg/s vs an 8.69 msg/s baseline). The chat log itself
 * was not stored, so chat is synthesised at those rates (regulars send ~2
 * messages per 10 s, repliers mostly once).
 */
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/ohnepixel-question.json", import.meta.url), "utf8"),
) as {
  rawClipStartAt: string;
  moment: { startedAt: string; peakAt: string; messageRate: number; baselineRate: number };
  words: { text: string; start: number; end: number }[];
};

const rawStart = Date.parse(fixture.rawClipStartAt);
const replyStart = Date.parse(fixture.moment.startedAt);

function chat(atMs: number, user: string, text = "ok", channel = "ohnepixel"): ChatEvent {
  return {
    channelLogin: channel,
    userLogin: user,
    text,
    emoteTokens: [],
    receivedAt: new Date(atMs).toISOString(),
  };
}

/** Feed `rate` msg/s from a pool of `pool` regulars between two times. */
function feed(
  detector: QuestionReplyDetector,
  fromMs: number,
  toMs: number,
  rate: number,
  pool: number,
  prefix: string,
) {
  const step = 1000 / rate;
  let i = 0;
  for (let t = fromMs; t < toMs; t += step, i += 1) {
    detector.ingest(chat(t, `${prefix}${(i * 37) % pool}`));
  }
}

function run(detector: QuestionReplyDetector, fromMs: number, toMs: number) {
  const out = [];
  for (let t = fromMs; t <= toMs; t += 1000) {
    const moment = detector.tick(t);
    if (moment) out.push(moment);
  }
  return out;
}

describe("question -> replies", () => {
  it("finds the spoken question in the reference transcript", () => {
    const questions = findSpokenQuestions(fixture.words);
    assert.equal(questions[0]?.text, "Did you ever subscribe to something or no?");
    assert.ok(Math.abs((questions[0]?.start ?? 0) - 10.8) < 0.5);
  });

  it("flags the reference moment: question, then a reply flood from many chatters", () => {
    const detector = new QuestionReplyDetector("ohnepixel");
    const baselineRate = fixture.moment.baselineRate;
    feed(detector, replyStart - 90_000, replyStart, baselineRate, 40, "regular");
    feed(detector, replyStart, replyStart + 10_000, fixture.moment.messageRate, 400, "replier");
    feed(detector, replyStart + 10_000, replyStart + 30_000, baselineRate, 40, "regular");
    for (const q of findSpokenQuestions(fixture.words)) {
      detector.noteQuestion({ atMs: rawStart + q.start * 1000, source: "speech", text: q.text });
    }
    const moments = run(detector, replyStart, replyStart + 30_000);
    assert.equal(moments.length, 1, "the follow-up questions merge into one");
    const moment = moments[0]!;
    assert.equal(moment.kind, "question_reply");
    assert.equal(moment.questionText, "Did you ever subscribe to something or no?");
    const peak = Date.parse(moment.peakAt);
    assert.ok(peak >= replyStart && peak <= replyStart + 6_000);
  });

  it("does not flag a question during normal chatter", () => {
    const detector = new QuestionReplyDetector("ohnepixel");
    feed(detector, replyStart - 90_000, replyStart + 30_000, 8.7, 40, "regular");
    detector.ingest(chat(replyStart - 4_000, "ohnepixel", "you guys ever subscribe to something?"));
    assert.equal(isBroadcasterQuestion(chat(0, "ohnepixel", "what do you think?")), true);
    assert.equal(run(detector, replyStart - 4_000, replyStart + 30_000).length, 0);
  });
});
