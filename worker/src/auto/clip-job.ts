import { spawn } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getLogger,
  normalizeLogin,
  type AutoSettings,
  type CandidateMoment,
  type ClipRecord,
  type CropRect,
  type TimedWord,
  type VerticalLayout,
} from "@gta6-clipper/shared";
import { transcribeClip, type Transcript } from "../ai/transcribe";
import { writeTitles, type TitlePack } from "../ai/titles";
import { type FacecamDetector, shouldUseFacecam, type FacecamDetection } from "../detect/facecam";
import { alignWordsToWindow, snapWindow, type ClipWindow } from "../detect/highlight";
import {
  detectCutHints,
  measureIntegratedLufs,
  probeVideo,
  renderVerticalShort,
} from "../export/render";

const log = getLogger("worker.clip");

export type SourceWindow = {
  /** Stream-copied source MP4. */
  path: string;
  /** Capture-clock time of the first frame in `path`. */
  fileStartMs: number;
};

export type ClipJobInput = {
  moment: CandidateMoment;
  window: ClipWindow;
  source: SourceWindow;
  settings: AutoSettings;
  outputDir: string;
  facecam: FacecamDetector;
  facecamOverride?: CropRect | undefined;
  streamTitle?: string;
  transcribe?: (filePath: string) => Promise<Transcript>;
  titles?: typeof writeTitles;
};

export type ClipJobResult = {
  record: ClipRecord;
  sidecarPath: string;
  titles: TitlePack[];
};

/** `ohnepixel_20261123-153425_spike_9312694b` */
export function clipBaseName(
  channelLogin: string,
  eventMs: number,
  kind: CandidateMoment["kind"],
  id: string,
): string {
  const iso = new Date(eventMs).toISOString();
  const stamp = `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
  const tag = kind === "question_reply" ? "question" : "spike";
  return `${normalizeLogin(channelLogin)}_${stamp}_${tag}_${id.slice(0, 8)}`;
}

/**
 * Everything after capture: snap the window to natural cut points, pick the
 * layout (multi-frame facecam), transcribe and align captions to the trimmed
 * window, write copy, render (frame-accurate trim, loudnorm, fades), grab the
 * thumbnail at the peak frame, and write the sidecar JSON.
 */
export async function runClipJob(input: ClipJobInput): Promise<ClipJobResult> {
  const { moment, settings, source } = input;
  const id = crypto.randomUUID();
  const base = path.join(
    input.outputDir,
    clipBaseName(moment.channelLogin, input.window.eventMs, moment.kind, id),
  );
  await mkdir(input.outputDir, { recursive: true });
  const outputPath = `${base}.mp4`;
  const posterPath = `${base}.jpg`;
  const sidecarPath = `${base}.json`;
  const probed = await probeVideo(source.path);
  const fileEndMs = source.fileStartMs + (probed?.duration ?? 0) * 1000;

  // 1. Snap to a nearby silence or scene cut, then clamp to what the file covers.
  const hintsFrom = Math.max(0, (input.window.startMs - source.fileStartMs) / 1000 - 2);
  const hintsDuration = (input.window.endMs - input.window.startMs) / 1000 + 4;
  const hints = await detectCutHints(source.path, hintsFrom, hintsDuration).catch(() => ({
    silences: [],
    sceneCuts: [],
  }));
  const snapped = snapWindow(input.window, {
    silences: hints.silences.map((item) => ({
      startMs: source.fileStartMs + item.start * 1000,
      endMs: source.fileStartMs + item.end * 1000,
    })),
    sceneCuts: hints.sceneCuts.map((at) => source.fileStartMs + at * 1000),
  });
  const startMs = Math.max(snapped.startMs, source.fileStartMs);
  const endMs = probed?.duration ? Math.min(snapped.endMs, fileEndMs - 50) : snapped.endMs;
  const trimStartSeconds = (startMs - source.fileStartMs) / 1000;
  const durationSeconds = Math.max(1, (endMs - startMs) / 1000);
  const peakOffsetSeconds = clamp(
    (snapped.peakVideoMs - startMs) / 1000,
    0.5,
    Math.max(0.5, durationSeconds - 0.5),
  );

  const record: ClipRecord = {
    id,
    momentId: moment.id,
    channelLogin: moment.channelLogin,
    layout: "blurred-background",
    sourcePath: source.path,
    outputPath,
    posterPath,
    startedAt: new Date(startMs).toISOString(),
    durationSeconds,
    hookTitle: "",
    status: "rendering",
    errorMessage: undefined,
    createdAt: new Date().toISOString(),
    clipType: moment.kind ?? "chat_spike",
    eventAt: new Date(snapped.eventMs).toISOString(),
    peakAt: new Date(snapped.peakVideoMs).toISOString(),
    highlightStartAt: new Date(startMs).toISOString(),
    highlightEndAt: new Date(endMs).toISOString(),
    peakOffsetSeconds: Number(peakOffsetSeconds.toFixed(3)),
    hypeScore: moment.hypeScore,
  };

  // 2. Layout: facecam consensus over three frames inside the window.
  let layout: VerticalLayout;
  let facecamInfo: Record<string, unknown> = { method: "none" };
  if (input.facecamOverride) {
    layout = { layout: "stacked-split", facecam: input.facecamOverride };
    facecamInfo = { method: "override" };
  } else {
    const frames: string[] = [];
    for (const fraction of [0.2, 0.5, 0.8]) {
      const frame = `${base}-facecam-${Math.round(fraction * 100)}.png`;
      const ok = await extractFrame(
        source.path,
        frame,
        trimStartSeconds + durationSeconds * fraction,
        "png",
      );
      if (ok) frames.push(frame);
    }
    const detected: FacecamDetection | undefined = frames.length
      ? await input.facecam.detectBestForChannel(moment.channelLogin, frames, probed?.size)
      : undefined;
    await Promise.all(frames.map((frame) => rm(frame, { force: true })));
    if (shouldUseFacecam(detected)) {
      layout = { layout: "stacked-split", facecam: detected.rect };
      facecamInfo = {
        method: detected.method,
        confidence: detected.confidence,
        rect: detected.rect,
      };
    } else {
      layout = { layout: "blurred-background", hookTitle: "" };
      facecamInfo = {
        method: "fallback",
        confidence: (detected as FacecamDetection | undefined)?.confidence ?? 0,
      };
    }
  }
  record.layout = layout.layout;

  // 3. Captions: transcribe the source, keep words inside the trimmed window.
  let transcript: Transcript = { text: "", words: [] };
  try {
    transcript = await (input.transcribe ?? transcribeClip)(source.path);
  } catch {
    transcript = { text: "", words: [] };
  }
  const words: TimedWord[] = alignWordsToWindow(
    transcript.words,
    trimStartSeconds,
    durationSeconds,
  );
  const windowText = words.map((word) => word.text).join(" ");

  // 4. Copy (Ollama or templates).
  const titles = await (input.titles ?? writeTitles)({
    planId: settings.planId,
    transcript: windowText || transcript.text,
    streamTitle: input.streamTitle ?? "",
    channelLogin: moment.channelLogin,
    reasons: moment.reasons,
    ...(moment.questionText ? { questionText: moment.questionText } : {}),
  });
  const pack = titles[0];
  record.hookTitle = pack?.title ?? "";
  if (layout.layout === "blurred-background") {
    layout = { layout: "blurred-background", hookTitle: pack?.hookText ?? "" };
  }

  // 5. Render.
  try {
    const result = await renderVerticalShort({
      inputPath: source.path,
      outputPath,
      layout,
      words,
      credit: { login: moment.channelLogin },
      durationSeconds,
      trimStartSeconds,
      ...(probed?.size ? { source: probed.size } : {}),
      ...(probed?.fps ? { fps: probed.fps } : {}),
      crf: settings.renderCrf,
      preset: settings.renderPreset,
      targetLufs: settings.targetLufs,
      includeAudio: true,
    });
    const posterOk = await extractFrame(outputPath, posterPath, peakOffsetSeconds, "jpg");
    if (!posterOk) record.posterPath = undefined;
    const outputLufs = await measureIntegratedLufs(outputPath);
    const rendered = await probeVideo(outputPath);
    record.status = "ready";
    if (rendered?.duration) record.durationSeconds = Number(rendered.duration.toFixed(3));
    await writeSidecarAtomic(sidecarPath, {
      version: 2,
      clipId: record.id,
      clipType: record.clipType,
      channelLogin: moment.channelLogin,
      credit: `twitch.tv/${moment.channelLogin}`,
      files: {
        video: path.basename(outputPath),
        thumbnail: record.posterPath ? path.basename(posterPath) : null,
      },
      highlight: {
        eventAt: record.eventAt,
        peakAt: record.peakAt,
        startAt: record.highlightStartAt,
        endAt: record.highlightEndAt,
        peakOffsetSeconds: record.peakOffsetSeconds,
        score: moment.hypeScore,
        reasons: moment.reasons,
        chat: {
          burstStartAt: moment.burstStartAt ?? moment.startedAt,
          peakAt: moment.peakAt,
          burstEndAt: moment.burstEndAt ?? null,
          messageRate: moment.messageRate,
          baselineRate: moment.baselineRate,
          zScore: moment.zScore,
        },
        question: moment.questionText
          ? { text: moment.questionText, at: moment.questionAt, source: moment.questionSource }
          : null,
        snapped: { start: snapped.snappedStart, end: snapped.snappedEnd },
        chatDelaySeconds: settings.chatDelaySeconds,
      },
      media: {
        width: 1080,
        height: 1920,
        fps: result.fps,
        durationSeconds: record.durationSeconds,
        bytes: result.bytes,
        videoCodec: "h264 (libx264 high)",
        crf: settings.renderCrf,
        preset: settings.renderPreset,
        audio: "aac 192k 48kHz stereo",
        loudness: {
          targetLufs: settings.targetLufs,
          sourceLufs: result.sourceLufs ?? null,
          outputLufs: outputLufs ?? null,
        },
      },
      layout: { id: layout.layout, facecam: facecamInfo },
      copy: titles.map((item) => ({
        platform: item.platform,
        title: item.title,
        description: item.description,
        hashtags: item.hashtags,
        hookText: item.hookText,
        source: item.source,
      })),
      transcript: windowText,
      language: transcript.language ?? null,
      createdAt: record.createdAt,
    });
    if (!settings.keepRaw) {
      await rm(source.path, { force: true });
      record.sourcePath = "";
    }
  } catch (error) {
    record.status = "failed";
    record.errorMessage = error instanceof Error ? error.message.slice(0, 500) : "Render failed";
    log.warn({ channel: moment.channelLogin, err: record.errorMessage }, "Clip render failed");
  }
  return { record, sidecarPath, titles };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function writeSidecarAtomic(filePath: string, payload: unknown): Promise<void> {
  const tmp = `${filePath}.partial`;
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(tmp, filePath);
}

/** One frame at `atSeconds` (accurate seek), PNG for detection or JPEG for thumbnails. */
export function extractFrame(
  videoPath: string,
  outPath: string,
  atSeconds: number,
  format: "png" | "jpg",
): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      Math.max(0, atSeconds).toFixed(3),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      ...(format === "jpg" ? ["-q:v", "2"] : []),
      outPath,
    ];
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
