import type { Database } from "./database.types";
import {
  PERMISSION_METHODS,
  PERMISSION_STATUSES,
  type PermissionMethod,
  type PermissionReceipt,
  type StoredPermissionStatus,
} from "./permissions";

export type PermissionReceiptRow = Database["public"]["Tables"]["permission_receipts"]["Row"];

function isMethod(value: string | null): value is PermissionMethod {
  return value !== null && (PERMISSION_METHODS as readonly string[]).includes(value);
}

function isStatus(value: string): value is StoredPermissionStatus {
  return (PERMISSION_STATUSES as readonly string[]).includes(value);
}

/** Map a Supabase permission_receipts row to the app's receipt shape. */
export function receiptFromRow(row: PermissionReceiptRow): PermissionReceipt {
  return {
    channelLogin: row.channel_login,
    status: isStatus(row.status) ? row.status : "revoked",
    ...(isMethod(row.source) ? { method: row.source } : {}),
    ...(row.evidence_url ? { evidenceUrl: row.evidence_url } : {}),
    ...(row.notes ? { note: row.notes } : {}),
    ...(row.granted_on ? { grantedOn: row.granted_on } : {}),
    ...(row.requested_at ? { requestedAt: row.requested_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    ...(row.revoke_reason ? { revokeReason: row.revoke_reason } : {}),
    updatedAt: row.updated_at,
  };
}
