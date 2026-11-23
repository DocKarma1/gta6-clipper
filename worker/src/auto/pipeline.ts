import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  assertCaptionStyle,
  assertClipsThisMonth,
  capConcurrentStreams,
  getLogger,
  normalizeLogin,
  PlanLimitError,
  startOfUtcMonth,
  type AutoSettings,
  type CaptionStyleId,
  type CandidateMoment,
  type ClipRecord,
  type CropRect,
  type LiveStream,
  type VerticalLayout,
} from "@gta6-clipper/shared";
import { getLiveGta6Streams } from "@gta6-clipper/twitch";
import { TwitchAnonymousIrc } from "../chat/irc";
import { ChannelSpikeDetector } from "../detect/spikes";
import { renderVerticalShort } from "../export/render";
import { StreamCapture } from "../media/capture";
import type { ClipperRepository } from "../repo/interface";
import { selectStreams } from "./select";

const log = getLogger("worker.auto");

export type PipelineOptions = {
  settings: AutoSettings;
  repository: ClipperRepository;
  facecamByChannel?: Record<string, CropRect>;
  sampleOutputDir?: string;
};

export class AutoPipeline {
  private readonly irc: TwitchAnonymousIrc;
  private readonly captures = new Map<string, StreamCapture>();
  private readonly detectors = new Map<string, ChannelSpikeDetector>();
  private selected: LiveStream[] = [];
  private pruneTimer: NodeJS.Timeout | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private running = false;
  readonly moments: CandidateMoment[] = [];
  readonly clips: ClipRecord[] = [];

  constructor(private readonly options: PipelineOptions) {
    this.irc = new TwitchAnonymousIrc({
      onChat: (event) => {
        const moment = this.detectors.get(event.channelLogin)?.ingest(event);
        if (moment) void this.onMoment(moment);
      },
    });
  }

  async start(): Promise<void> {
    this.running = true;
    this.irc.start();
    await this.refreshSelection();
    this.pollTimer = setInterval(() => {
      void this.refreshSelection();
    }, this.options.settings.pollIntervalMs);
    this.pruneTimer = setInterval(() => {
      void Promise.all([...this.captures.values()].map((capture) => capture.prune()));
    }, 15_000);
    log.info(
      {
        topK: this.options.settings.topK,
        requirePermission: this.options.settings.requirePermission,
        writeLocalOnly: this.options.settings.writeLocalOnly,
        pollIntervalMs: this.options.settings.pollIntervalMs,
      },
      "Auto worker started",
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.irc.stop();
    await Promise.all([...this.captures.values()].map((capture) => capture.stop()));
    this.captures.clear();
  }

  getSelectedLogins(): string[] {
    return this.selected.map((stream) => stream.streamerLogin);
  }

  private async refreshSelection(): Promise<void> {
    try {
      const live = await getLiveGta6Streams({ skipCache: true });
      const next = capConcurrentStreams(
        this.options.settings.planId,
        selectStreams(live.streams, this.options.settings),
      );
      this.selected = next;
      const logins = next.map((stream) => normalizeLogin(stream.streamerLogin));
      this.irc.sync(logins);
      for (const stream of next) {
        const login = normalizeLogin(stream.streamerLogin);
        this.options.repository.upsertStream({
          channelLogin: login,
          channelId: undefined,
          title: stream.title,
          language: stream.language,
          viewerCount: stream.viewerCount,
          thumbnailUrl: stream.thumbnailUrl,
          url: stream.url,
        });
        if (!this.detectors.has(login)) {
          this.detectors.set(
            login,
            new ChannelSpikeDetector(login, {
              cooldownMs: this.options.settings.cooldownSeconds * 1000,
            }),
          );
        }
        if (!this.captures.has(login)) {
          const capture = new StreamCapture(login, this.options.settings);
          this.captures.set(login, capture);
          void capture.start();
        }
      }
      for (const [login, capture] of this.captures) {
        if (!logins.includes(login)) {
          await capture.stop();
          this.captures.delete(login);
          this.detectors.delete(login);
        }
      }
      log.info({ count: logins.length, channels: logins }, "Updated watched channels");
    } catch (error) {
      log.warn(
        { err: error instanceof Error ? error.message : "unknown" },
        "Failed to refresh the live directory",
      );
    }
  }

  private async onMoment(moment: CandidateMoment): Promise<void> {
    this.moments.push(moment);
    await this.options.repository.saveMoment(moment);
    log.info(
      {
        channel: moment.channelLogin,
        hypeScore: moment.hypeScore,
        reasons: moment.reasons,
        zScore: moment.zScore,
      },
      "Detected a chat spike",
    );
    if (!this.running) return;
    const settings = this.options.settings;
    await delay(settings.postRollSeconds * 1000);
    const capture = this.captures.get(moment.channelLogin);
    if (!capture) return;
    const peak = Date.parse(moment.peakAt);
    const startMs = peak - settings.preRollSeconds * 1000;
    const endMs = peak + settings.postRollSeconds * 1000;
    const durationSeconds = settings.preRollSeconds + settings.postRollSeconds;
    const sampleDir = this.options.sampleOutputDir ?? path.join(settings.dataDir, "clips");
    const base = path.join(sampleDir, `${moment.channelLogin}-${moment.id.slice(0, 8)}`);
    const sourcePath = `${base}-raw.mp4`;
    const outputPath = `${base}.mp4`;
    const posterPath = `${base}.png`;
    const hookTitle = hookTitleFrom(moment);
    const layout = this.layoutFor(moment.channelLogin, hookTitle);
    const record: ClipRecord = {
      id: randomUUID(),
      momentId: moment.id,
      channelLogin: moment.channelLogin,
      layout: layout.layout,
      sourcePath,
      outputPath,
      posterPath,
      startedAt: new Date(startMs).toISOString(),
      durationSeconds,
      hookTitle,
      status: "rendering",
      errorMessage: undefined,
      createdAt: new Date().toISOString(),
    };
    try {
      const used = await this.options.repository.countClipsSince(startOfUtcMonth().toISOString());
      assertClipsThisMonth(settings.planId, used);
      assertCaptionStyle(settings.planId, "default" satisfies CaptionStyleId);
    } catch (error) {
      if (error instanceof PlanLimitError) {
        record.status = "failed";
        record.errorMessage = error.message;
        this.clips.push(record);
        await this.options.repository.saveClip(record);
        log.warn(
          { channel: moment.channelLogin, limit: error.limit },
          "Skipped a clip because of a plan limit",
        );
        return;
      }
      throw error;
    }
    const extracted = await capture.extractWindow(startMs, endMs, sourcePath);
    if (!extracted) {
      record.status = "failed";
      record.errorMessage = "No buffered video covered this moment.";
      this.clips.push(record);
      await this.options.repository.saveClip(record);
      return;
    }
    try {
      await renderVerticalShort({
        inputPath: sourcePath,
        outputPath,
        layout,
        words: [],
        credit: { login: moment.channelLogin },
        durationSeconds,
        includeAudio: true,
      });
      await extractPng(outputPath, posterPath, Math.min(8, durationSeconds / 2));
      record.status = "ready";
    } catch (error) {
      record.status = "failed";
      record.errorMessage = error instanceof Error ? error.message : "Render failed";
    }
    this.clips.push(record);
    await this.options.repository.saveClip(record);
    log.info(
      { channel: moment.channelLogin, status: record.status, outputPath },
      "Finished a local clip job",
    );
  }

  private layoutFor(channelLogin: string, hookTitle: string): VerticalLayout {
    const facecam = this.options.facecamByChannel?.[normalizeLogin(channelLogin)];
    if (facecam) {
      return { layout: "stacked-split", facecam };
    }
    return { layout: "blurred-background", hookTitle };
  }
}

function hookTitleFrom(moment: CandidateMoment): string {
  if (moment.reasons.some((reason) => reason.includes("clip"))) return "CLIP IT";
  if (moment.reasons.includes("emote-flood")) return "CHAT LOST IT";
  return "WHAT A PLAY";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractPng(videoPath: string, pngPath: string, atSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-hide_banner", "-y", "-ss", String(atSeconds), "-i", videoPath, "-frames:v", "1", pngPath],
      {
        stdio: "ignore",
      },
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Could not extract a poster frame."));
    });
    child.on("error", reject);
  });
}
