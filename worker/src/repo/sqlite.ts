import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CandidateMoment, ClipRecord, MomentKind, WatchedStream } from "@gta6-clipper/shared";
import type { ClipperRepository } from "./interface";

export class SqliteClipRepository implements ClipperRepository {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "clipper.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streams (
        channel_login TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT NOT NULL,
        language TEXT NOT NULL,
        viewer_count INTEGER NOT NULL,
        thumbnail_url TEXT NOT NULL,
        url TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS moments (
        id TEXT PRIMARY KEY,
        channel_login TEXT NOT NULL,
        channel_id TEXT,
        started_at TEXT NOT NULL,
        peak_at TEXT NOT NULL,
        hype_score INTEGER NOT NULL,
        reasons TEXT NOT NULL,
        message_rate REAL NOT NULL,
        baseline_rate REAL NOT NULL,
        z_score REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS clips (
        id TEXT PRIMARY KEY,
        moment_id TEXT NOT NULL,
        channel_login TEXT NOT NULL,
        layout TEXT NOT NULL,
        source_path TEXT NOT NULL,
        output_path TEXT NOT NULL,
        poster_path TEXT,
        started_at TEXT NOT NULL,
        duration_seconds REAL NOT NULL,
        hook_title TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.addColumns("moments", {
      kind: "TEXT",
      burst_start_at: "TEXT",
      burst_end_at: "TEXT",
      question_text: "TEXT",
    });
    this.addColumns("clips", {
      clip_type: "TEXT",
      event_at: "TEXT",
      peak_at: "TEXT",
      highlight_start_at: "TEXT",
      highlight_end_at: "TEXT",
      peak_offset_seconds: "REAL",
      hype_score: "INTEGER",
    });
  }

  /** Additive migrations for databases created by earlier versions. */
  private addColumns(table: string, columns: Record<string, string>): void {
    const existing = new Set(
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    for (const [name, type] of Object.entries(columns)) {
      if (!existing.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }

  async upsertStream(stream: WatchedStream): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO streams (channel_login, channel_id, title, language, viewer_count, thumbnail_url, url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_login) DO UPDATE SET
           channel_id=excluded.channel_id, title=excluded.title, language=excluded.language,
           viewer_count=excluded.viewer_count, thumbnail_url=excluded.thumbnail_url, url=excluded.url, updated_at=excluded.updated_at`,
      )
      .run(
        stream.channelLogin,
        stream.channelId ?? null,
        stream.title,
        stream.language,
        stream.viewerCount,
        stream.thumbnailUrl,
        stream.url,
        new Date().toISOString(),
      );
  }

  async saveMoment(moment: CandidateMoment): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO moments (id, channel_login, channel_id, started_at, peak_at, hype_score, reasons, message_rate, baseline_rate, z_score, kind, burst_start_at, burst_end_at, question_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        moment.id,
        moment.channelLogin,
        moment.channelId ?? null,
        moment.startedAt,
        moment.peakAt,
        moment.hypeScore,
        JSON.stringify(moment.reasons),
        moment.messageRate,
        moment.baselineRate,
        moment.zScore,
        moment.kind ?? "chat_spike",
        moment.burstStartAt ?? null,
        moment.burstEndAt ?? null,
        moment.questionText ?? null,
      );
  }

  async saveClip(clip: ClipRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO clips (id, moment_id, channel_login, layout, source_path, output_path, poster_path, started_at, duration_seconds, hook_title, status, error_message, created_at, clip_type, event_at, peak_at, highlight_start_at, highlight_end_at, peak_offset_seconds, hype_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clip.id,
        clip.momentId ?? null,
        clip.channelLogin,
        clip.layout,
        clip.sourcePath,
        clip.outputPath,
        clip.posterPath ?? null,
        clip.startedAt,
        clip.durationSeconds,
        clip.hookTitle,
        clip.status,
        clip.errorMessage ?? null,
        clip.createdAt,
        clip.clipType ?? "chat_spike",
        clip.eventAt ?? null,
        clip.peakAt ?? null,
        clip.highlightStartAt ?? null,
        clip.highlightEndAt ?? null,
        clip.peakOffsetSeconds ?? null,
        clip.hypeScore ?? null,
      );
  }

  async listRecentMoments(limit: number): Promise<CandidateMoment[]> {
    const rows = this.db
      .prepare(`SELECT * FROM moments ORDER BY peak_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      channelLogin: String(row.channel_login),
      channelId: row.channel_id ? String(row.channel_id) : undefined,
      startedAt: String(row.started_at),
      peakAt: String(row.peak_at),
      hypeScore: Number(row.hype_score),
      reasons: JSON.parse(String(row.reasons)) as string[],
      messageRate: Number(row.message_rate),
      baselineRate: Number(row.baseline_rate),
      zScore: Number(row.z_score),
      ...(row.kind ? { kind: row.kind as MomentKind } : {}),
      ...(row.burst_start_at ? { burstStartAt: String(row.burst_start_at) } : {}),
      ...(row.burst_end_at ? { burstEndAt: String(row.burst_end_at) } : {}),
      ...(row.question_text ? { questionText: String(row.question_text) } : {}),
    }));
  }

  async listRecentClips(limit: number): Promise<ClipRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM clips ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      momentId: String(row.moment_id),
      channelLogin: String(row.channel_login),
      layout: row.layout as ClipRecord["layout"],
      sourcePath: String(row.source_path),
      outputPath: String(row.output_path),
      posterPath: row.poster_path ? String(row.poster_path) : undefined,
      startedAt: String(row.started_at),
      durationSeconds: Number(row.duration_seconds),
      hookTitle: String(row.hook_title),
      status: row.status as ClipRecord["status"],
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      createdAt: String(row.created_at),
      ...clipHighlightFromRow(row),
    }));
  }

  async countClipsSince(isoTimestamp: string): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM clips WHERE created_at >= ? AND status IN ('ready', 'rendering')`,
      )
      .get(isoTimestamp) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }

  async markInterruptedClips(): Promise<number> {
    const result = this.db
      .prepare(
        `UPDATE clips SET status = 'failed', error_message = 'Interrupted: the worker stopped while rendering.' WHERE status = 'rendering'`,
      )
      .run();
    return Number(result.changes ?? 0);
  }

  close(): void {
    this.db.close();
  }
}

/** Optional highlight columns shared by the worker and the web queue. */
export function clipHighlightFromRow(row: Record<string, unknown>): Partial<ClipRecord> {
  return {
    ...(row.clip_type ? { clipType: row.clip_type as MomentKind } : {}),
    ...(row.event_at ? { eventAt: String(row.event_at) } : {}),
    ...(row.peak_at ? { peakAt: String(row.peak_at) } : {}),
    ...(row.highlight_start_at ? { highlightStartAt: String(row.highlight_start_at) } : {}),
    ...(row.highlight_end_at ? { highlightEndAt: String(row.highlight_end_at) } : {}),
    ...(row.peak_offset_seconds !== null && row.peak_offset_seconds !== undefined
      ? { peakOffsetSeconds: Number(row.peak_offset_seconds) }
      : {}),
    ...(row.hype_score !== null && row.hype_score !== undefined
      ? { hypeScore: Number(row.hype_score) }
      : {}),
  };
}
