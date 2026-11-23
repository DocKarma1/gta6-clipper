import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CandidateMoment, ChatEvent } from "@gta6-clipper/shared";
import { ChannelSpikeDetector } from "./spikes";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

function event(atMs: number, user: string, text: string, emotes: string[] = []): ChatEvent {
  return {
    channelLogin: "alpha",
    userLogin: user,
    text,
    emoteTokens: emotes,
    receivedAt: new Date(atMs).toISOString(),
  };
}

/** Steady chat: `perSecond` messages each second from rotating users. */
function baseline(detector: ChannelSpikeDetector, fromS: number, toS: number, perSecond = 1) {
  const out: CandidateMoment[] = [];
  for (let s = fromS; s < toS; s += 1) {
    for (let i = 0; i < perSecond; i += 1) {
      const m = detector.ingest(event(T0 + s * 1000 + i * 37, `lurker${(s + i) % 7}`, "nice"));
      if (m) out.push(m);
    }
    const t = detector.tick(T0 + s * 1000 + 999);
    if (t) out.push(t);
  }
  return out;
}

/** A burst shaped like real chat: rises, peaks at `peakS`, decays. */
function burst(
  detector: ChannelSpikeDetector,
  startS: number,
  profile: number[],
  text = "LUL KEKW",
) {
  const out: CandidateMoment[] = [];
  profile.forEach((count, offset) => {
    const s = startS + offset;
    for (let i = 0; i < count; i += 1) {
      const msg = i % 4 === 0 ? "CLIP IT" : text;
      const m = detector.ingest(
        event(T0 + s * 1000 + Math.floor((i * 1000) / Math.max(count, 1)), `fan${s}_${i}`, msg, [
          "LUL",
        ]),
      );
      if (m) out.push(m);
    }
    const t = detector.tick(T0 + s * 1000 + 999);
    if (t) out.push(t);
  });
  return out;
}

describe("ChannelSpikeDetector", () => {
  it("does not fire during a steady baseline", () => {
    const detector = new ChannelSpikeDetector("alpha");
    assert.equal(baseline(detector, 0, 120, 2).length, 0);
  });

  it("does not fire when one user spams hype words", () => {
    const detector = new ChannelSpikeDetector("alpha");
    baseline(detector, 0, 70);
    for (let i = 0; i < 30; i += 1) {
      detector.ingest(event(T0 + 70_000 + i * 150, "spammer", "LUL LUL CLIP IT"));
    }
    let hit = null;
    for (let s = 70; s < 95; s += 1) hit = detector.tick(T0 + s * 1000 + 999) ?? hit;
    assert.equal(hit, null);
  });

  it("waits for the burst to settle and reports the real peak and onset", () => {
    const detector = new ChannelSpikeDetector("alpha");
    baseline(detector, 0, 70);
    // Onset at 70 s, peak at 73 s, decays by ~77 s.
    const moments = [
      ...burst(detector, 70, [4, 8, 14, 22, 15, 9, 5, 2, 1, 1]),
      ...baseline(detector, 80, 90),
    ];
    assert.equal(moments.length, 1);
    const moment = moments[0]!;
    const peakS = (Date.parse(moment.peakAt) - T0) / 1000;
    const onsetS = (Date.parse(moment.burstStartAt!) - T0) / 1000;
    assert.ok(peakS >= 72.5 && peakS <= 74.5, `peak at ${peakS}`);
    assert.ok(onsetS >= 69 && onsetS <= 71, `onset at ${onsetS}`);
    assert.ok(Date.parse(moment.burstEndAt!) > Date.parse(moment.peakAt));
    assert.ok(moment.hypeScore >= 55 && moment.hypeScore <= 100);
    assert.ok(moment.reasons.includes("rate-spike"));
  });

  it("merges a double-peak burst into one moment and honours the cooldown", () => {
    const detector = new ChannelSpikeDetector("alpha", { cooldownMs: 45_000 });
    baseline(detector, 0, 70);
    const first = burst(detector, 70, [6, 14, 20, 12, 16, 18, 9, 4, 2, 1]);
    const later = [...baseline(detector, 80, 95), ...burst(detector, 95, [6, 14, 20, 10, 4, 1])];
    const all = [...first, ...later];
    assert.equal(all.length, 1, "second wave inside the cooldown is ignored");
  });

  it("fires again after the cooldown", () => {
    const detector = new ChannelSpikeDetector("alpha", { cooldownMs: 30_000 });
    baseline(detector, 0, 70);
    const first = burst(detector, 70, [6, 14, 20, 10, 4, 1, 1, 1]);
    const quiet = baseline(detector, 78, 140);
    const second = burst(detector, 140, [6, 14, 20, 10, 4, 1, 1, 1]);
    const tail = baseline(detector, 148, 155);
    assert.equal([...first, ...quiet, ...second, ...tail].length, 2);
  });

  it("settles a burst on tick when chat suddenly stops", () => {
    const detector = new ChannelSpikeDetector("alpha");
    baseline(detector, 0, 70);
    burst(detector, 70, [8, 16, 20]);
    let moment = null;
    for (let s = 73; s < 80 && !moment; s += 1) moment = detector.tick(T0 + s * 1000 + 999);
    assert.ok(moment);
  });
});
