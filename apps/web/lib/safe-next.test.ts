import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNextPath } from "./safe-next";

test("keeps relative paths and rejects open redirects", () => {
  assert.equal(safeNextPath("/queue"), "/queue");
  assert.equal(safeNextPath("//evil.example"), "/dashboard");
  assert.equal(safeNextPath("/\\evil.example"), "/dashboard");
  assert.equal(safeNextPath("https://evil.example"), "/dashboard");
  assert.equal(safeNextPath(null), "/dashboard");
});
