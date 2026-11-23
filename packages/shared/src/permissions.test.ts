import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LocalPermissionStore } from "./permission-store-local";
import {
  grantPermissionInputSchema,
  isChannelAllowed,
  resolvePermissionPolicy,
  statusFor,
  type PermissionReceipt,
} from "./permissions";

const now = new Date().toISOString();
const receipt = (channelLogin: string, status: PermissionReceipt["status"]): PermissionReceipt => ({
  channelLogin,
  status,
  updatedAt: now,
});

describe("resolvePermissionPolicy", () => {
  it("defaults to requiring permission from env and only allows granted channels", () => {
    const policy = resolvePermissionPolicy({
      envRequirePermission: true,
      envPermittedChannels: [],
      receipts: [receipt("alpha", "granted"), receipt("bravo", "requested")],
    });
    assert.equal(policy.requirePermission, true);
    assert.equal(policy.source, "env");
    assert.deepEqual(policy.permittedChannels, ["alpha"]);
    assert.equal(isChannelAllowed(policy, "Alpha"), true);
    assert.equal(isChannelAllowed(policy, "bravo"), false);
    assert.equal(isChannelAllowed(policy, "charlie"), false);
  });

  it("lets a stored workspace setting override env and skips the check when off", () => {
    const policy = resolvePermissionPolicy({
      envRequirePermission: true,
      envPermittedChannels: [],
      workspaceRequirePermission: false,
      receipts: [],
    });
    assert.equal(policy.requirePermission, false);
    assert.equal(policy.source, "workspace");
    assert.equal(isChannelAllowed(policy, "anyone"), true);
  });

  it("lets a revoke win over AUTO_PERMITTED_CHANNELS", () => {
    const policy = resolvePermissionPolicy({
      envRequirePermission: true,
      envPermittedChannels: ["@Delta", "echo"],
      receipts: [receipt("delta", "revoked")],
    });
    assert.deepEqual(policy.permittedChannels, ["echo"]);
  });
});

describe("grantPermissionInputSchema", () => {
  it("normalises logins and rejects bad URLs and future dates", () => {
    const ok = grantPermissionInputSchema.safeParse({
      channelLogin: " @OhnePixel ",
      method: "dm",
      evidenceUrl: "https://x.com/example/status/1",
      note: "",
      grantedOn: "2026-11-01",
    });
    assert.equal(ok.success, true);
    if (ok.success) {
      assert.equal(ok.data.channelLogin, "ohnepixel");
      assert.equal(ok.data.note, undefined);
    }
    const badUrl = grantPermissionInputSchema.safeParse({
      channelLogin: "a",
      method: "dm",
      evidenceUrl: "javascript:alert(1)",
      grantedOn: "2026-11-01",
    });
    assert.equal(badUrl.success, false);
    const future = grantPermissionInputSchema.safeParse({
      channelLogin: "a",
      method: "email",
      grantedOn: "2999-01-01",
    });
    assert.equal(future.success, false);
    const badLogin = grantPermissionInputSchema.safeParse({
      channelLogin: "not a login!",
      method: "email",
      grantedOn: "2026-11-01",
    });
    assert.equal(badLogin.success, false);
  });
});

describe("LocalPermissionStore", () => {
  it("records request, grant, and revoke, and stores the workspace toggle", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "perm-"));
    try {
      const store = new LocalPermissionStore(dir);
      assert.equal(store.getRequirePermission(), undefined);
      store.markRequested("zeta");
      assert.equal(statusFor(store.listReceipts(), "zeta"), "requested");
      store.grant({ channelLogin: "zeta", method: "email", grantedOn: "2026-11-20", note: "ok" });
      const granted = store.listReceipts()[0];
      assert.equal(granted?.status, "granted");
      assert.equal(granted?.method, "email");
      assert.ok(granted?.requestedAt);
      store.revoke({ channelLogin: "zeta", reason: "asked to stop" });
      const revoked = store.listReceipts()[0];
      assert.equal(revoked?.status, "revoked");
      assert.equal(revoked?.revokeReason, "asked to stop");
      assert.equal(revoked?.method, "email");
      store.setRequirePermission(false);
      assert.equal(store.getRequirePermission(), false);
      store.setRequirePermission(true);
      assert.equal(store.getRequirePermission(), true);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
