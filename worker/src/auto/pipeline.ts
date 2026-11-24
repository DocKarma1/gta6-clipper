import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import {
  canUseAiTitles,
  getConfig,
  getOllamaSettings,
  assertCaptionStyle,
  assertClipsThisMonth,
  capConcurrentStreams,
  DEFAULT_WATCHLIST,
  effectiveStreamCap,
  getLogger,
  normalizeLogin,
  PlanLimitError,
  startOfUtcMonth,
  watchlistPriorityByLogin,
  type AutoSettings,
  type CaptionStyleId,
  type CandidateMoment,
  type ClipRecord,
  type CropRect,
} from "@gta6-clipper/shared";
import { getAutoCandidates } from "@gta6-clipper/twitch";
import { TwitchAnonymousIrc } from "../chat/irc";
import { ChannelSpikeDetector } from "../detect/spikes";
import { QuestionReplyDetector, findSpokenQuestions } from "../detect/question";
import { StreamCapture } from "../media/capture";
import { transcribeClip } from "../ai/transcribe";
import { FacecamDetector } from "../detect/facecam";
import type { ClipWindow } from "../detect/highlight";
import type { ClipperRepository } from "../repo/interface";
import { OllamaClient } from "../ai/ollama";
import { TrendStore } from "../trends/store";
import { runClipJob } from "./clip-job";
import { selectStreams, type SelectedStream } from "./select";
import { windowForQuestion, windowForSpike, windowOverlap } from "./windows";

const log = getLogger("worker.auto");

export type PipelineOptions = {
  settings: AutoSettings;
  repository: ClipperRepository;
  facecamByChannel?: Record<string, CropRect>;
  facecamDetector?: FacecamDetector;
  sampleOutputDir?: string;
  /** Test hook; otherwise built from settings.trends when TRENDS_ENABLED=true. */
  trendStore?: TrendStore;
};

/** Small FIFO semaphore so a home PC renders one (or N) clips at a time. */
class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export class AutoPipeline {
  private readonly irc: TwitchAnonymousIrc;
  private readonly captures = new Map<string, StreamCapture>();
  private readonly detectors = new Map<string, ChannelSpikeDetector>();
  private readonly questions = new Map<string, QuestionReplyDetector>();
  /** Last clip window per channel, for dedupe across detectors. */
  private readonly lastWindows = new Map<string, ClipWindow>();
  /** Speech already transcribed per channel (capture clock). */
  private readonly speechUntil = new Map<string, number>();
  private readonly facecam: FacecamDetector;
  private readonly renders: Limiter;
  private readonly trends: TrendStore | undefined;
  private readonly trendOllama: OllamaClient | undefined;
  private selected: SelectedStream[] = [];
  private timers: NodeJS.Timeout[] = [];
  private speechBusy = false;
  private speechCursor = 0;
  private running = false;
  readonly moments: CandidateMoment[] = [];
  readonly clips: ClipRecord[] = [];

  constructor(private readonly options: PipelineOptions) {
    this.facecam =
      options.facecamDetector ??
      new FacecamDetector({
        cachePath: path.join(options.settings.dataDir, "facecam-cache.json"),
      });
    this.renders = new Limiter(options.settings.renderConcurrency);
    const trendSettings = options.settings.trends;
    if (trendSettings.enabled) {
      this.trends =
        options.trendStore ??
        new TrendStore({
          cachePath: path.join(options.settings.dataDir, "trends-cache.json"),
          ttlMs: trendSettings.ttlMs,
          language: trendSettings.language,
          youtubeSeeds: trendSettings.seeds,
          youtubeApiKey: optionalYouTubeKey(),
        });
      if (trendSettings.useOllama && canUseAiTitles(options.settings.planId)) {
        const ollama = getOllamaSettings();
        this.trendOllama = new OllamaClient({
          baseUrl: ollama.url,
          model: ollama.model,
          timeoutMs: ollama.timeoutMs,
          retries: 0,
        });
      }
    }
    this.irc = new TwitchAnonymousIrc({
      onChat: (event) => {
        this.questions.get(event.channelLogin)?.ingest(event);
        const moment = this.detectors.get(event.channelLogin)?.ingest(event);
        if (moment) void this.onMoment(moment);
      },
    });
  }

  get outputDir(): string {
    return this.options.sampleOutputDir ?? path.join(this.options.settings.dataDir, "clips");
  }

  async start(): Promise<void> {
    this.running = true;
    await this.recoverFromCrash();
    // Warm the trend cache in the background; clip jobs never wait on the network for long.
    if (this.trends) void this.trends.getTopics();
    this.irc.start();
    await this.refreshSelection();
    const { settings } = this.options;
    this.timers.push(setInterval(() => void this.refreshSelection(), settings.pollIntervalMs));
    this.timers.push(
      setInterval(() => {
        void Promise.all([...this.captures.values()].map((capture) => capture.prune()));
      }, 15_000),
    );
    this.timers.push(setInterval(() => this.tick(Date.now()), 1_000));
    if (settings.speechQuestionSeconds > 0) {
      // One channel per slot keeps Whisper's CPU use flat with up to 3 streams.
      const slotMs = Math.max(
        5_000,
        Math.round(
          (settings.speechQuestionSeconds * 1000) / Math.max(1, effectiveStreamCap(settings)),
        ),
      );
      this.timers.push(setInterval(() => void this.sampleSpeech(), slotMs));
    }
    log.info(
      {
        streamCap: effectiveStreamCap(settings),
        watchlist: settings.useWatchlist,
        includeGtaV: settings.includeGtaV,
        quality: settings.streamQuality,
        renderConcurrency: settings.renderConcurrency,
        speechQuestionSeconds: settings.speechQuestionSeconds,
        writeLocalOnly: settings.writeLocalOnly,
        pollIntervalMs: settings.pollIntervalMs,
        trends: settings.trends.enabled
          ? {
              weight: settings.trends.weight,
              minScore: settings.trends.minScore ?? null,
              minCombinedScore: settings.trends.minCombinedScore ?? null,
              ollama: Boolean(this.trendOllama),
            }
          : false,
      },
      "Auto worker started",
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.irc.stop();
    await Promise.all([...this.captures.values()].map((capture) => capture.stop()));
    this.captures.clear();
  }

  getSelectedLogins(): string[] {
    return this.selected.map((stream) => stream.streamerLogin);
  }

  /** Remove half-written files and mark clips that were rendering as interrupted. */
  private async recoverFromCrash(): Promise<void> {
    try {
      for (const name of await readdir(this.outputDir)) {
        if (name.includes(".partial.") || name.endsWith(".partial") || name.startsWith(".src-")) {
          await rm(path.join(this.outputDir, name), { force: true });
        }
      }
    } catch {
      // No output directory yet.
    }
    const marked = (await this.options.repository.markInterruptedClips?.()) ?? 0;
    if (marked > 0) log.info({ clips: marked }, "Marked clips from a previous run as interrupted");
  }

  private tick(now: number): void {
    for (const detector of this.detectors.values()) {
      const moment = detector.tick(now);
      if (moment) void this.onMoment(moment);
    }
    for (const detector of this.questions.values()) {
      const moment = detector.tick(now);
      if (moment) void this.onMoment(moment);
    }
  }

  private async refreshSelection(): Promise<void> {
    try {
      const settings = this.options.settings;
      const priorities = settings.useWatchlist
        ? watchlistPriorityByLogin(DEFAULT_WATCHLIST)
        : new Map<string, number>();
      const candidates = await getAutoCandidates({
        watchlistLogins: [...priorities.keys()],
        includeGtaV: settings.includeGtaV,
      });
      const next = capConcurrentStreams(
        settings.planId,
        selectStreams(
          { directory: candidates.directory, watchlistLive: candidates.watchlistLive, priorities },
          { ...settings, topK: effectiveStreamCap(settings) },
        ),
      );
      this.selected = next;
      const logins = next.map((stream) => normalizeLogin(stream.streamerLogin));
      this.irc.sync(logins);
      for (const stream of next) {
        const login = normalizeLogin(stream.streamerLogin);
        await this.options.repository
          .upsertStream({
            channelLogin: login,
            channelId: undefined,
            title: stream.title,
            language: stream.language,
            viewerCount: stream.viewerCount,
            thumbnailUrl: stream.thumbnailUrl,
            url: stream.url,
          })
          .catch(() => undefined);
        if (!this.detectors.has(login)) {
          this.detectors.set(
            login,
            new ChannelSpikeDetector(login, { cooldownMs: settings.cooldownSeconds * 1000 }),
          );
          this.questions.set(
            login,
            new QuestionReplyDetector(login, { cooldownMs: settings.cooldownSeconds * 1000 }),
          );
        }
        if (!this.captures.has(login)) {
          const capture = new StreamCapture(login, settings);
          this.captures.set(login, capture);
          void capture.start();
        }
      }
      for (const [login, capture] of this.captures) {
        if (!logins.includes(login)) {
          await capture.stop();
          this.captures.delete(login);
          this.detectors.delete(login);
          this.questions.delete(login);
          this.speechUntil.delete(login);
        }
      }
      log.info(
        {
          count: logins.length,
          channels: next.map((stream) => `${stream.streamerLogin}(${stream.reason})`),
        },
        "Updated watched channels",
      );
    } catch (error) {
      log.warn(
        { err: error instanceof Error ? error.message : "unknown" },
        "Failed to refresh the live directory",
      );
    }
  }

  /** Transcribe the newest buffered audio of one channel and note spoken questions. */
  private async sampleSpeech(): Promise<void> {
    if (this.speechBusy || !this.running) return;
    const logins = [...this.captures.keys()];
    if (logins.length === 0) return;
    const login = logins[this.speechCursor % logins.length]!;
    this.speechCursor += 1;
    const capture = this.captures.get(login);
    const detector = this.questions.get(login);
    if (!capture || !detector) return;
    this.speechBusy = true;
    const wav = path.join(this.options.settings.dataDir, "speech", `${login}.wav`);
    try {
      const seconds = this.options.settings.speechQuestionSeconds + 5;
      const audio = await capture.extractRecentAudio(seconds, wav);
      if (!audio) return;
      const transcript = await transcribeClip(audio.path, {
        model: this.options.settings.speechModel,
        timeoutMs: 60_000,
      });
      const seenUntil = this.speechUntil.get(login) ?? 0;
      let latest = seenUntil;
      for (const question of findSpokenQuestions(transcript.words)) {
        const atMs = audio.fileStartMs + question.start * 1000;
        if (atMs <= seenUntil) continue;
        latest = Math.max(latest, atMs);
        detector.noteQuestion({ atMs, source: "speech", text: question.text });
      }
      this.speechUntil.set(login, latest);
    } catch (error) {
      log.debug(
        { err: error instanceof Error ? error.message : "unknown" },
        "Speech sample skipped",
      );
    } finally {
      this.speechBusy = false;
      await rm(wav, { force: true });
    }
  }

  private async onMoment(moment: CandidateMoment): Promise<void> {
    this.moments.push(moment);
    await this.options.repository.saveMoment(moment).catch(() => undefined);
    log.info(
      {
        channel: moment.channelLogin,
        kind: moment.kind ?? "chat_spike",
        hypeScore: moment.hypeScore,
        reasons: moment.reasons,
        peakAt: moment.peakAt,
      },
      "Detected a highlight",
    );
    if (!this.running) return;
    const settings = this.options.settings;
    const window =
      moment.kind === "question_reply"
        ? windowForQuestion(moment, settings)
        : windowForSpike(moment, settings);

    const previous = this.lastWindows.get(moment.channelLogin);
    if (previous && windowOverlap(previous, window) > 0.5) {
      log.info({ channel: moment.channelLogin }, "Skipped a highlight that overlaps the last clip");
      return;
    }
    this.lastWindows.set(moment.channelLogin, window);

    const capture = this.captures.get(moment.channelLogin);
    if (!capture) return;

    try {
      const used = await this.options.repository.countClipsSince(startOfUtcMonth().toISOString());
      assertClipsThisMonth(settings.planId, used);
      assertCaptionStyle(settings.planId, "default" satisfies CaptionStyleId);
    } catch (error) {
      if (error instanceof PlanLimitError) {
        log.warn(
          { channel: moment.channelLogin, limit: error.limit },
          "Skipped a clip because of a plan limit",
        );
        return;
      }
      throw error;
    }

    // Wait until the buffer has written video past the end of the window.
    const deadline = Date.now() + 90_000;
    while (this.running && Date.now() < deadline) {
      const until = await capture.bufferedUntilMs();
      if (until !== undefined && until >= window.endMs + 1_000) break;
      await delay(1_000);
    }
    if (!this.running) return;

    const rawPath = path.join(
      this.outputDir,
      `.src-${moment.channelLogin}-${moment.id.slice(0, 8)}.mp4`,
    );
    // Pad 3 s on both sides so silence/scene snapping has room.
    const extracted = await capture.extractWindow(
      window.startMs - 3_000,
      window.endMs + 3_000,
      rawPath,
    );
    if (!extracted) {
      log.warn({ channel: moment.channelLogin }, "No buffered video covered this highlight");
      return;
    }

    const streamTitle =
      this.selected.find((stream) => normalizeLogin(stream.streamerLogin) === moment.channelLogin)
        ?.title ?? "";
    const result = await this.renders.run(() =>
      runClipJob({
        moment,
        window,
        source: { path: extracted.path, fileStartMs: extracted.fileStartMs },
        settings,
        outputDir: this.outputDir,
        facecam: this.facecam,
        facecamOverride: this.options.facecamByChannel?.[normalizeLogin(moment.channelLogin)],
        streamTitle,
        trends: this.trends,
        trendOllama: this.trendOllama,
      }),
    );
    if (result.skipped) return;
    this.clips.push(result.record);
    await this.options.repository.saveClip(result.record);
    log.info(
      {
        channel: moment.channelLogin,
        status: result.record.status,
        outputPath: result.record.outputPath,
        durationSeconds: result.record.durationSeconds,
        ...(result.trend
          ? {
              reactionScore: result.trend.reactionScore,
              trendScore: result.trend.trendScore,
              combinedScore: result.trend.combinedScore,
              trendTopics: result.trend.matches.slice(0, 3).map((match) => match.label),
            }
          : {}),
      },
      "Finished a local clip job",
    );
  }
}

/** YOUTUBE_API_KEY enables the optional Data API trend source; never logged. */
function optionalYouTubeKey(): string | undefined {
  try {
    return getConfig().YOUTUBE_API_KEY;
  } catch {
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
