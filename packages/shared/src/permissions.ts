import { z } from "zod";
import { normalizeLogin } from "./auto-settings";

/** Stored receipt states. A streamer with no receipt has the status "none". */
export const PERMISSION_STATUSES = ["requested", "granted", "revoked"] as const;
export type StoredPermissionStatus = (typeof PERMISSION_STATUSES)[number];
export type PermissionStatus = "none" | StoredPermissionStatus;

export const PERMISSION_METHODS = [
  "public_clip_policy",
  "dm",
  "email",
  "written",
  "campaign",
  "own_channel",
  "other",
] as const;
export type PermissionMethod = (typeof PERMISSION_METHODS)[number];

export const PERMISSION_METHOD_LABELS: Record<PermissionMethod, string> = {
  public_clip_policy: "Public clip policy (panel, About page, or stream rules)",
  dm: "Direct message",
  email: "Email",
  written: "Written agreement",
  campaign: "Brand or clipping campaign",
  own_channel: "My own channel",
  other: "Other",
};

export type PermissionReceipt = {
  channelLogin: string;
  status: StoredPermissionStatus;
  method?: PermissionMethod;
  evidenceUrl?: string;
  note?: string;
  /** YYYY-MM-DD, the day the streamer granted permission. */
  grantedOn?: string;
  requestedAt?: string;
  revokedAt?: string;
  revokeReason?: string;
  updatedAt: string;
};

/** Twitch logins are 1–25 characters of a–z, 0–9 and underscore. */
export const TWITCH_LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/u;

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

export const channelLoginSchema = z
  .string()
  .transform((value) => normalizeLogin(value))
  .refine((value) => TWITCH_LOGIN_PATTERN.test(value), {
    message: "Enter a Twitch login (letters, numbers, underscore; max 25).",
  });

export const grantPermissionInputSchema = z.object({
  channelLogin: channelLoginSchema,
  method: z.enum(PERMISSION_METHODS, {
    errorMap: () => ({ message: "Choose how permission was granted." }),
  }),
  evidenceUrl: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .trim()
      .url({ message: "Evidence must be a full http(s) URL." })
      .refine((value) => /^https?:\/\//iu.test(value), {
        message: "Evidence must be a full http(s) URL.",
      })
      .optional(),
  ),
  note: optionalText(1000),
  grantedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, { message: "Use the date the streamer said yes." })
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
      message: "Use a real calendar date.",
    })
    .refine((value) => Date.parse(`${value}T00:00:00Z`) <= Date.now(), {
      message: "The grant date cannot be in the future.",
    }),
});
export type GrantPermissionInput = z.infer<typeof grantPermissionInputSchema>;

export const revokePermissionInputSchema = z.object({
  channelLogin: channelLoginSchema,
  reason: optionalText(500),
});
export type RevokePermissionInput = z.infer<typeof revokePermissionInputSchema>;

export function hasEvidence(input: Pick<GrantPermissionInput, "evidenceUrl" | "note">): boolean {
  return Boolean(input.evidenceUrl || input.note);
}

export function statusFor(
  receipts: readonly PermissionReceipt[],
  channelLogin: string,
): PermissionStatus {
  const login = normalizeLogin(channelLogin);
  return receipts.find((receipt) => receipt.channelLogin === login)?.status ?? "none";
}

export function grantedLogins(receipts: readonly PermissionReceipt[]): string[] {
  return receipts
    .filter((receipt) => receipt.status === "granted")
    .map((receipt) => normalizeLogin(receipt.channelLogin));
}

export type EffectivePermissionPolicy = {
  requirePermission: boolean;
  permittedChannels: string[];
  /** Where requirePermission came from, for logs. */
  source: "workspace" | "env";
};

/**
 * Combine the workspace setting with the env fallback.
 * - The workspace setting wins when one is stored; env AUTO_REQUIRE_PERMISSION is the fallback.
 * - Permitted channels are granted receipts plus AUTO_PERMITTED_CHANNELS, minus any
 *   channel whose latest receipt is revoked (a revoke always wins over env).
 */
export function resolvePermissionPolicy(input: {
  envRequirePermission: boolean;
  envPermittedChannels: readonly string[];
  workspaceRequirePermission?: boolean | undefined;
  receipts: readonly PermissionReceipt[];
}): EffectivePermissionPolicy {
  const revoked = new Set(
    input.receipts
      .filter((receipt) => receipt.status === "revoked")
      .map((receipt) => normalizeLogin(receipt.channelLogin)),
  );
  const permitted = new Set<string>();
  for (const login of [
    ...input.envPermittedChannels.map(normalizeLogin),
    ...grantedLogins(input.receipts),
  ]) {
    if (!revoked.has(login)) permitted.add(login);
  }
  const fromWorkspace = typeof input.workspaceRequirePermission === "boolean";
  return {
    requirePermission: fromWorkspace
      ? (input.workspaceRequirePermission as boolean)
      : input.envRequirePermission,
    permittedChannels: [...permitted].sort(),
    source: fromWorkspace ? "workspace" : "env",
  };
}

export function isChannelAllowed(policy: EffectivePermissionPolicy, channelLogin: string): boolean {
  if (!policy.requirePermission) return true;
  return policy.permittedChannels.includes(normalizeLogin(channelLogin));
}

export const REQUIRE_PERMISSION_WARNING =
  "Turning this off lets the worker clip any live GTA 6 stream it picks, including streamers who never agreed. Reposting someone else's stream without permission can lead to DMCA takedowns, copyright strikes, and suspended TikTok, YouTube, Instagram, or Facebook accounts. You are responsible for every clip you publish.";
