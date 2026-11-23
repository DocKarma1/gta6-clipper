import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAutoSettings, type ClipRecord } from "@gta6-clipper/shared";

const SAMPLE_ROOT = "/workspace/gta6-clipper-samples";

export function clipStorageRoots(): string[] {
  const settings = getAutoSettings();
  return [path.resolve(settings.dataDir), path.resolve(SAMPLE_ROOT)];
}

export function isAllowedClipPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return clipStorageRoots().some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
  );
}

function mapClip(row: Record<string, unknown>): ClipRecord {
  return {
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
  };
}

export function readLocalClips(limit = 40): ClipRecord[] {
  const dbPath = path.join(getAutoSettings().dataDir, "clipper.sqlite");
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(`SELECT * FROM clips ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(mapClip);
  } finally {
    db.close();
  }
}

export function readLocalClip(id: string): ClipRecord | undefined {
  return readLocalClips(200).find((clip) => clip.id === id);
}

export type PublicClip = {
  id: string;
  channelLogin: string;
  hookTitle: string;
  layout: ClipRecord["layout"];
  status: ClipRecord["status"];
  errorMessage?: string;
  durationSeconds: number;
  createdAt: string;
  hasVideo: boolean;
  hasPoster: boolean;
};

export function toPublicClip(clip: ClipRecord): PublicClip {
  return {
    id: clip.id,
    channelLogin: clip.channelLogin,
    hookTitle: clip.hookTitle,
    layout: clip.layout,
    status: clip.status,
    ...(clip.errorMessage ? { errorMessage: clip.errorMessage } : {}),
    durationSeconds: clip.durationSeconds,
    createdAt: clip.createdAt,
    hasVideo: Boolean(
      clip.outputPath && existsSync(clip.outputPath) && isAllowedClipPath(clip.outputPath),
    ),
    hasPoster: Boolean(
      clip.posterPath && existsSync(clip.posterPath) && isAllowedClipPath(clip.posterPath),
    ),
  };
}
