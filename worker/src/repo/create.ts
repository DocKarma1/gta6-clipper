import { getConfig, getLogger } from "@gta6-clipper/shared";
import type { ClipperRepository } from "./interface";
import { SqliteClipRepository } from "./sqlite";
import { SupabaseClipRepository } from "./supabase";

const log = getLogger("worker.repo");

export function createClipperRepository(dataDir: string): ClipperRepository {
  const config = getConfig();
  const workspaceId = process.env.AUTO_WORKSPACE_ID?.trim();
  if (config.NEXT_PUBLIC_SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY && workspaceId) {
    log.info("Using the Supabase clip repository");
    return new SupabaseClipRepository(workspaceId);
  }
  if (config.SUPABASE_SERVICE_ROLE_KEY && !workspaceId) {
    log.warn("SUPABASE_SERVICE_ROLE_KEY is set but AUTO_WORKSPACE_ID is not; using local SQLite");
  }
  log.info({ dataDir }, "Using the local SQLite clip repository");
  return new SqliteClipRepository(dataDir);
}
