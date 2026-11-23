import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transcribeScriptPath } from "./transcribe";

describe("transcribeClip", () => {
  it("points at the worker faster-whisper helper", () => {
    assert.match(transcribeScriptPath(), /worker\/scripts\/transcribe\.py$/);
  });
});
