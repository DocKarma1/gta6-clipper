import {
  getConfig,
  getLogger,
  LocalPermissionStore,
  receiptFromRow,
  resolvePermissionPolicy,
  type AutoSettings,
  type Database,
  type EffectivePermissionPolicy,
  type PermissionReceipt,
} from "@gta6-clipper/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const log = getLogger("worker.permissions");

export type PermissionSnapshot = {
  /** undefined when the workspace never stored a value; env is the fallback. */
  workspaceRequirePermission: boolean | undefined;
  receipts: PermissionReceipt[];
};

export interface PermissionSource {
  readonly kind: "local" | "supabase";
  load(): Promise<PermissionSnapshot>;
}

/** Reads receipts the web app wrote to DATA_DIR/clipper.sqlite. */
export class LocalPermissionSource implements PermissionSource {
  readonly kind = "local" as const;

  constructor(private readonly dataDir: string) {}

  async load(): Promise<PermissionSnapshot> {
    const store = new LocalPermissionStore(this.dataDir);
    try {
      return {
        workspaceRequirePermission: store.getRequirePermission(),
        receipts: store.listReceipts(),
      };
    } finally {
      store.close();
    }
  }
}

/** Reads one workspace's receipts and settings with the service role key. */
export class SupabasePermissionSource implements PermissionSource {
  readonly kind = "supabase" as const;

  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly workspaceId: string,
  ) {}

  async load(): Promise<PermissionSnapshot> {
    const [receipts, settings] = await Promise.all([
      this.client.from("permission_receipts").select("*").eq("workspace_id", this.workspaceId),
      this.client
        .from("workspace_settings")
        .select("require_permission")
        .eq("workspace_id", this.workspaceId)
        .maybeSingle(),
    ]);
    if (receipts.error) throw receipts.error;
    if (settings.error) throw settings.error;
    return {
      workspaceRequirePermission: settings.data?.require_permission ?? undefined,
      receipts: (receipts.data ?? []).map(receiptFromRow),
    };
  }
}

export function createPermissionSource(settings: AutoSettings): PermissionSource {
  const config = getConfig();
  if (config.NEXT_PUBLIC_SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY && settings.workspaceId) {
    log.info({ workspaceId: settings.workspaceId }, "Reading permission receipts from Supabase");
    const client = createClient<Database>(
      config.NEXT_PUBLIC_SUPABASE_URL,
      config.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    return new SupabasePermissionSource(client, settings.workspaceId);
  }
  log.info(
    "Reading permission receipts from the local SQLite store (set SUPABASE_SERVICE_ROLE_KEY and AUTO_WORKSPACE_ID to read them from Supabase)",
  );
  return new LocalPermissionSource(settings.dataDir);
}

/**
 * Load the effective policy. If the source fails, fail closed: require
 * permission and allow only AUTO_PERMITTED_CHANNELS.
 */
export async function loadPermissionPolicy(
  source: PermissionSource,
  settings: Pick<AutoSettings, "requirePermission" | "permittedChannels">,
): Promise<EffectivePermissionPolicy> {
  try {
    const snapshot = await source.load();
    return resolvePermissionPolicy({
      envRequirePermission: settings.requirePermission,
      envPermittedChannels: settings.permittedChannels,
      workspaceRequirePermission: snapshot.workspaceRequirePermission,
      receipts: snapshot.receipts,
    });
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : "unknown", source: source.kind },
      "Could not load permission receipts; failing closed",
    );
    return resolvePermissionPolicy({
      envRequirePermission: true,
      envPermittedChannels: settings.permittedChannels,
      receipts: [],
    });
  }
}
