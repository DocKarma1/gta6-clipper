import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ConfigError,
  getConfig,
  getLogger,
  type CandidateMoment,
  type ClipRecord,
  type MomentKind,
  type WatchedStream,
} from "@gta6-clipper/shared";
import { isQaMigrationMissing, legacyClipRow } from "../qa/db-compat";
import type { ClipperRepository } from "./interface";

const log = getLogger("worker.supabase");

export function createSupabaseAdmin(): SupabaseClient {
  const config = getConfig();
  const url = config.NEXT_PUBLIC_SUPABASE_URL;
  const key = config.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ConfigError(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Use the SQLite repository for local development.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class SupabaseClipRepository implements ClipperRepository {
  /**
   * workspaceId tags every row so RLS shows it to that workspace's members
   * (the service role bypasses RLS; rows without a workspace are invisible in the app).
   */
  constructor(
    private readonly workspaceId: string | undefined = process.env.AUTO_WORKSPACE_ID || undefined,
    private readonly client: SupabaseClient = createSupabaseAdmin(),
  ) {}

  private scoped(): { workspace_id: string } | Record<string, never> {
    return this.workspaceId ? { workspace_id: this.workspaceId } : {};
  }

  async upsertStream(stream: WatchedStream): Promise<void> {
    const { error } = await this.client.from("streams").upsert(
      {
        channel_login: stream.channelLogin,
        channel_id: stream.channelId ?? null,
        title: stream.title,
        language: stream.language,
        viewer_count: stream.viewerCount,
        thumbnail_url: stream.thumbnailUrl,
        url: stream.url,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_login" },
    );
    if (error) throw error;
  }

  async saveMoment(moment: CandidateMoment): Promise<void> {
    const { error } = await this.client.from("moments").upsert({
      ...this.scoped(),
      id: moment.id,
      channel_login: moment.channelLogin,
      channel_id: moment.channelId ?? null,
      started_at: moment.startedAt,
      peak_at: moment.peakAt,
      hype_score: moment.hypeScore,
      reasons: moment.reasons,
      message_rate: moment.messageRate,
      baseline_rate: moment.baselineRate,
      z_score: moment.zScore,
      kind: moment.kind ?? "chat_spike",
      burst_start_at: moment.burstStartAt ?? null,
      burst_end_at: moment.burstEndAt ?? null,
      question_text: moment.questionText ?? null,
    });
    if (error) throw error;
  }

  async saveClip(clip: ClipRecord): Promise<void> {
    const row = {
      ...this.scoped(),
      id: clip.id,
      moment_id: clip.momentId,
      channel_login: clip.channelLogin,
      layout: clip.layout,
      source_path: clip.sourcePath,
      output_path: clip.outputPath,
      poster_path: clip.posterPath ?? null,
      started_at: clip.startedAt,
      duration_seconds: clip.durationSeconds,
      hook_title: clip.hookTitle,
      status: clip.status,
      error_message: clip.errorMessage ?? null,
      created_at: clip.createdAt,
      clip_type: clip.clipType ?? "chat_spike",
      event_at: clip.eventAt ?? null,
      peak_at: clip.peakAt ?? null,
      highlight_start_at: clip.highlightStartAt ?? null,
      highlight_end_at: clip.highlightEndAt ?? null,
      peak_offset_seconds: clip.peakOffsetSeconds ?? null,
      hype_score: clip.hypeScore ?? null,
      qa: clip.qa ?? null,
    };
    const { error } = await this.client.from("clips").upsert(row);
    if (error && isQaMigrationMissing(error)) {
      // QA migration not applied yet: store a pre-migration row ("review" -> "failed").
      log.warn("clips.qa / status 'review' missing in Supabase; apply the QA migration");
      const retry = await this.client.from("clips").upsert(legacyClipRow(row));
      if (retry.error) throw retry.error;
      return;
    }
    if (error) throw error;
  }

  async listRecentMoments(limit: number): Promise<CandidateMoment[]> {
    const { data, error } = await this.client
      .from("moments")
      .select("*")
      .match(this.scoped())
      .order("peak_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      channelLogin: row.channel_login,
      channelId: row.channel_id ?? undefined,
      startedAt: row.started_at,
      peakAt: row.peak_at,
      hypeScore: row.hype_score,
      reasons: row.reasons ?? [],
      messageRate: row.message_rate,
      baselineRate: row.baseline_rate,
      zScore: row.z_score,
    }));
  }

  async listRecentClips(limit: number): Promise<ClipRecord[]> {
    const { data, error } = await this.client
      .from("clips")
      .select("*")
      .match(this.scoped())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      momentId: row.moment_id,
      channelLogin: row.channel_login,
      layout: row.layout,
      sourcePath: row.source_path,
      outputPath: row.output_path,
      posterPath: row.poster_path ?? undefined,
      startedAt: row.started_at,
      durationSeconds: row.duration_seconds,
      hookTitle: row.hook_title,
      status: row.status,
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      ...(row.clip_type ? { clipType: row.clip_type as MomentKind } : {}),
      ...(row.event_at ? { eventAt: row.event_at } : {}),
      ...(row.peak_at ? { peakAt: row.peak_at } : {}),
      ...(row.highlight_start_at ? { highlightStartAt: row.highlight_start_at } : {}),
      ...(row.highlight_end_at ? { highlightEndAt: row.highlight_end_at } : {}),
      ...(row.peak_offset_seconds != null ? { peakOffsetSeconds: row.peak_offset_seconds } : {}),
      ...(row.hype_score != null ? { hypeScore: row.hype_score } : {}),
      ...(row.qa ? { qa: row.qa } : {}),
    }));
  }

  async countClipsSince(isoTimestamp: string): Promise<number> {
    const { count, error } = await this.client
      .from("clips")
      .select("id", { count: "exact", head: true })
      .gte("created_at", isoTimestamp)
      .in("status", ["ready", "review", "rendering"])
      .match(this.scoped());
    if (error) throw error;
    return count ?? 0;
  }

  async markInterruptedClips(): Promise<number> {
    const { data, error } = await this.client
      .from("clips")
      .update({
        status: "failed",
        error_message: "Interrupted: the worker stopped while rendering.",
      })
      .eq("status", "rendering")
      .match(this.scoped())
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  }

  close(): void {
    // The HTTP client has no persistent connection to close.
  }
}
