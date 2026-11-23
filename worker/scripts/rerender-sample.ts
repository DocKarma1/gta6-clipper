/**
 * Re-run the post-capture clip pipeline on an existing local source file
 * (no live streams). Usage:
 *   npx tsx worker/scripts/rerender-sample.ts <raw.mp4> <fileStartIso> <burstStartIso> <peakIso> <login> <outDir> [questionIso questionText]
 */
import path from "node:path";
import { getAutoSettings, type CandidateMoment } from "@gta6-clipper/shared";
import { runClipJob } from "../src/auto/clip-job";
import { FacecamDetector } from "../src/detect/facecam";
import { planClipWindow } from "../src/detect/highlight";
import { windowForQuestion } from "../src/auto/windows";

const [raw, fileStartIso, burstIso, peakIso, login, outDir, questionIso, questionText] =
  process.argv.slice(2);
if (!raw || !fileStartIso || !burstIso || !peakIso || !login || !outDir) {
  console.error(
    "usage: rerender-sample.ts raw fileStart burstStart peak login outDir [questionAt questionText]",
  );
  process.exit(2);
}
const settings = { ...getAutoSettings(), keepRaw: true };
const burstStartMs = Date.parse(burstIso);
const peakMs = Date.parse(peakIso);
const moment: CandidateMoment = {
  id: crypto.randomUUID(),
  channelLogin: login,
  channelId: undefined,
  kind: questionIso ? "question_reply" : "chat_spike",
  ...(questionIso
    ? {
        questionAt: questionIso,
        questionSource: "speech" as const,
        questionText: questionText ?? "",
      }
    : {}),
  startedAt: burstIso,
  burstStartAt: burstIso,
  peakAt: peakIso,
  burstEndAt: new Date(peakMs + 4_000).toISOString(),
  hypeScore: 62,
  reasons: questionIso ? ["question-reply", "question:speech"] : ["rate-spike", "keyword:hype"],
  messageRate: 16,
  baselineRate: 8.69,
  zScore: 1.84,
};
const window = questionIso
  ? windowForQuestion(moment, settings)
  : planClipWindow({
      burstStartMs,
      peakMs,
      burstEndMs: peakMs + 4_000,
      chatDelaySeconds: settings.chatDelaySeconds,
      preRollSeconds: settings.preRollSeconds,
      postRollSeconds: settings.postRollSeconds,
      minSeconds: settings.minClipSeconds,
      maxSeconds: settings.maxClipSeconds,
    });
const started = Date.now();
const result = await runClipJob({
  moment,
  window,
  source: { path: path.resolve(raw), fileStartMs: Date.parse(fileStartIso) },
  settings,
  outputDir: path.resolve(outDir),
  facecam: new FacecamDetector({
    cachePath: path.join(settings.dataDir, "facecam-cache-rerender.json"),
  }),
});
console.log(
  JSON.stringify(
    {
      status: result.record.status,
      error: result.record.errorMessage,
      output: result.record.outputPath,
      sidecar: result.sidecarPath,
      layout: result.record.layout,
      window: {
        planned: window,
        startAt: result.record.highlightStartAt,
        endAt: result.record.highlightEndAt,
      },
      durationSeconds: result.record.durationSeconds,
      peakOffsetSeconds: result.record.peakOffsetSeconds,
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ),
);
