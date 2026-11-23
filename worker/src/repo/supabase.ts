import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ConfigError,
  getConfig,
  type CandidateMoment,
  type ClipRecord,
  type WatchedStream,
} from "@gta6-clipper/shared";
import type { ClipperRepository } from "./interface";

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
  constructor(private readonly client: SupabaseClient = createSupabaseAdmin()) {}

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
    });
    if (error) throw error;
  }

  async saveClip(clip: ClipRecord): Promise<void> {
    const { error } = await this.client.from("clips").upsert({
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
    });
    if (error) throw error;
  }

  async listRecentMoments(limit: number): Promise<CandidateMoment[]> {
    const { data, error } = await this.client
      .from("moments")
      .select("*")
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
    }));
  }

  async countClipsSince(isoTimestamp: string): Promise<number> {
    const { count, error } = await this.client
      .from("clips")
      .select("id", { count: "exact", head: true })
      .gte("created_at", isoTimestamp)
      .in("status", ["ready", "rendering"]);
    if (error) throw error;
    return count ?? 0;
  }

  close(): void {
    // The HTTP client has no persistent connection to close.
  }
}
