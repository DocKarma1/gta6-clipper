import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadPermissionPolicy, type PermissionSource } from "./source";

const env = { requirePermission: true, permittedChannels: ["envchan"] };

function fake(snapshot: Awaited<ReturnType<PermissionSource["load"]>>): PermissionSource {
  return { kind: "local", load: async () => snapshot };
}

describe("loadPermissionPolicy", () => {
  it("only permits granted receipts plus env channels when permission is required", async () => {
    const policy = await loadPermissionPolicy(
      fake({
        workspaceRequirePermission: undefined,
        receipts: [
          { channelLogin: "granted1", status: "granted", updatedAt: "" },
          { channelLogin: "asked", status: "requested", updatedAt: "" },
        ],
      }),
      env,
    );
    assert.equal(policy.requirePermission, true);
    assert.deepEqual(policy.permittedChannels, ["envchan", "granted1"]);
  });

  it("follows the workspace toggle when it is switched off", async () => {
    const policy = await loadPermissionPolicy(
      fake({ workspaceRequirePermission: false, receipts: [] }),
      env,
    );
    assert.equal(policy.requirePermission, false);
  });

  it("fails closed when the source throws", async () => {
    const policy = await loadPermissionPolicy(
      {
        kind: "supabase",
        load: async () => {
          throw new Error("network down");
        },
      },
      { requirePermission: false, permittedChannels: ["envchan"] },
    );
    assert.equal(policy.requirePermission, true);
    assert.deepEqual(policy.permittedChannels, ["envchan"]);
  });
});
