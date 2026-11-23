import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeLogin } from "./auto-settings";
import type {
  GrantPermissionInput,
  PermissionMethod,
  PermissionReceipt,
  RevokePermissionInput,
  StoredPermissionStatus,
} from "./permissions";

/**
 * Local single-workspace permission store in DATA_DIR/clipper.sqlite.
 * Used in local development mode and as the worker's source of truth until
 * the worker has a Supabase service role key. The web app mirrors Supabase
 * writes here so a worker on the same machine follows the same receipts.
 */
export class LocalPermissionStore {
  private readonly db: DatabaseSync;

  constructor(dataDir: string, options: { readOnly?: boolean } = {}) {
    if (!options.readOnly) mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "clipper.sqlite"), {
      readOnly: Boolean(options.readOnly),
    });
    if (!options.readOnly) this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permission_receipts (
        channel_login TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('requested', 'granted', 'revoked')),
        method TEXT,
        evidence_url TEXT,
        note TEXT,
        granted_on TEXT,
        requested_at TEXT,
        revoked_at TEXT,
        revoke_reason TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        require_permission INTEGER NOT NULL DEFAULT 1,
        acknowledged_at TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private hasTable(name: string): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name);
    return Boolean(row);
  }

  listReceipts(): PermissionReceipt[] {
    if (!this.hasTable("permission_receipts")) return [];
    const rows = this.db
      .prepare(`SELECT * FROM permission_receipts ORDER BY channel_login`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      channelLogin: String(row.channel_login),
      status: row.status as StoredPermissionStatus,
      ...(row.method ? { method: row.method as PermissionMethod } : {}),
      ...(row.evidence_url ? { evidenceUrl: String(row.evidence_url) } : {}),
      ...(row.note ? { note: String(row.note) } : {}),
      ...(row.granted_on ? { grantedOn: String(row.granted_on) } : {}),
      ...(row.requested_at ? { requestedAt: String(row.requested_at) } : {}),
      ...(row.revoked_at ? { revokedAt: String(row.revoked_at) } : {}),
      ...(row.revoke_reason ? { revokeReason: String(row.revoke_reason) } : {}),
      updatedAt: String(row.updated_at),
    }));
  }

  /** Replace the local copy of one receipt (used when mirroring Supabase). */
  putReceipt(receipt: PermissionReceipt): void {
    this.db
      .prepare(
        `INSERT INTO permission_receipts (channel_login, status, method, evidence_url, note, granted_on, requested_at, revoked_at, revoke_reason, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_login) DO UPDATE SET
           status=excluded.status, method=excluded.method, evidence_url=excluded.evidence_url,
           note=excluded.note, granted_on=excluded.granted_on, requested_at=excluded.requested_at,
           revoked_at=excluded.revoked_at, revoke_reason=excluded.revoke_reason, updated_at=excluded.updated_at`,
      )
      .run(
        normalizeLogin(receipt.channelLogin),
        receipt.status,
        receipt.method ?? null,
        receipt.evidenceUrl ?? null,
        receipt.note ?? null,
        receipt.grantedOn ?? null,
        receipt.requestedAt ?? null,
        receipt.revokedAt ?? null,
        receipt.revokeReason ?? null,
        receipt.updatedAt,
      );
  }

  private find(login: string): PermissionReceipt | undefined {
    return this.listReceipts().find((receipt) => receipt.channelLogin === normalizeLogin(login));
  }

  markRequested(channelLogin: string): PermissionReceipt {
    const now = new Date().toISOString();
    const existing = this.find(channelLogin);
    const receipt: PermissionReceipt = {
      channelLogin: normalizeLogin(channelLogin),
      status: "requested",
      requestedAt: now,
      updatedAt: now,
      ...(existing?.note ? { note: existing.note } : {}),
    };
    this.putReceipt(receipt);
    return receipt;
  }

  grant(input: GrantPermissionInput): PermissionReceipt {
    const existing = this.find(input.channelLogin);
    const receipt: PermissionReceipt = {
      channelLogin: input.channelLogin,
      status: "granted",
      method: input.method,
      grantedOn: input.grantedOn,
      ...(input.evidenceUrl ? { evidenceUrl: input.evidenceUrl } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(existing?.requestedAt ? { requestedAt: existing.requestedAt } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.putReceipt(receipt);
    return receipt;
  }

  revoke(input: RevokePermissionInput): PermissionReceipt | undefined {
    const existing = this.find(input.channelLogin);
    const now = new Date().toISOString();
    const receipt: PermissionReceipt = {
      ...(existing ?? { channelLogin: input.channelLogin }),
      status: "revoked",
      revokedAt: now,
      ...(input.reason ? { revokeReason: input.reason } : {}),
      updatedAt: now,
    } as PermissionReceipt;
    this.putReceipt(receipt);
    return receipt;
  }

  /** undefined means "never set here"; callers fall back to env. */
  getRequirePermission(): boolean | undefined {
    if (!this.hasTable("workspace_settings")) return undefined;
    const row = this.db
      .prepare(`SELECT require_permission FROM workspace_settings WHERE id = 1`)
      .get() as { require_permission: number } | undefined;
    return row ? row.require_permission === 1 : undefined;
  }

  setRequirePermission(value: boolean): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workspace_settings (id, require_permission, acknowledged_at, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET require_permission=excluded.require_permission,
           acknowledged_at=excluded.acknowledged_at, updated_at=excluded.updated_at`,
      )
      .run(value ? 1 : 0, value ? null : now, now);
  }

  close(): void {
    this.db.close();
  }
}
