import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildAssDocument } from "../media/ass";
import { main, parseArgs } from "./cli";
import { DEFAULT_QA_SETTINGS } from "./config";
import type { QaDeps } from "./gate";
import { findSidecars, qaInputFromSidecar, readSidecar } from "./sidecar";

const transcript = "he drove the police car off the pier into the ocean look at that splash";
const words = transcript
  .split(" ")
  .map((text, i) => ({ text, start: 1 + i * 0.6, end: 1.5 + i * 0.6 }));

function makeClipDir(): { dir: string; sidecar: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-cli-"));
  const base = "caseoh__20261123-153425_spike_9312694b";
  const sidecar = path.join(dir, `${base}.json`);
  writeFileSync(
    sidecar,
    JSON.stringify({
      version: 2,
      clipId: "9312694b-1111-2222-3333-444455556666",
      channelLogin: "caseoh_",
      credit: "twitch.tv/caseoh_",
      files: { video: `${base}.mp4`, thumbnail: null },
      highlight: { reasons: ["emote-flood"], question: null },
      copy: [
        {
          platform: "youtube",
          title: "CaseOh drives the police car off the pier",
          description: "caseoh_ and a police car.",
          hashtags: ["GTA6"],
          hookText: "POLICE CAR OFF THE PIER",
          source: "llm",
        },
      ],
      transcript,
    }),
  );
  writeFileSync(path.join(dir, `${base}.mp4`), "");
  writeFileSync(
    path.join(dir, `${base}.ass`),
    buildAssDocument({
      layout: { layout: "blurred-background", hookTitle: "POLICE CAR OFF THE PIER" },
      words,
      credit: { login: "caseoh_" },
      durationSeconds: 14,
    }),
  );
  writeFileSync(path.join(dir, "facecam-cache.json"), "{}");
  return { dir, sidecar };
}

const fakeDeps: QaDeps = {
  probe: async () => ({ width: 1080, height: 1920, durationSeconds: 14, hasAudio: true }),
  signals: async () => ({
    peakMomentaryLufs: -10,
    medianMomentaryLufs: -28,
    audioSpikeDb: 18,
    maxSceneScore: 0.4,
    meanSceneScore: 0.04,
  }),
  settings: DEFAULT_QA_SETTINGS,
};

async function quiet<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
  const log = console.log;
  const error = console.error;
  let out = "";
  console.log = (...args: unknown[]) => {
    out += `${args.join(" ")}\n`;
  };
  console.error = console.log;
  try {
    return { value: await fn(), out };
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("qa cli", () => {
  it("parses flags and rejects unknown ones", () => {
    assert.deepEqual(parseArgs(["clips", "--write", "--no-ollama"]), {
      targets: ["clips"],
      write: true,
      json: false,
      ollama: false,
    });
    assert.equal(parseArgs([]), undefined);
    assert.equal(parseArgs(["x", "--publish"]), undefined);
  });

  it("finds sidecars by directory, mp4, and clip id, and builds gate input", async () => {
    const { dir, sidecar } = makeClipDir();
    assert.deepEqual(await findSidecars(dir, dir), [sidecar]);
    assert.deepEqual(await findSidecars(sidecar.replace(/\.json$/u, ".mp4"), dir), [sidecar]);
    assert.deepEqual(await findSidecars("9312694b", dir), [sidecar]);
    assert.deepEqual(await findSidecars("deadbeef", dir), []);
    const data = await readSidecar(sidecar);
    assert.ok(data);
    const input = qaInputFromSidecar(sidecar, data);
    assert.equal(input.assPath, sidecar.replace(/\.json$/u, ".ass"));
    assert.equal(input.channelLogin, "caseoh_");
  });

  it("is read-only by default and writes the sidecar only with --write", async () => {
    const { dir, sidecar } = makeClipDir();
    const before = readFileSync(sidecar, "utf8");
    const run = await quiet(() => main([dir, "--no-ollama"], fakeDeps));
    assert.equal(run.value, 0);
    assert.match(run.out, /READY +caseoh__/);
    assert.match(run.out, /read-only/);
    assert.equal(readFileSync(sidecar, "utf8"), before);

    const written = await quiet(() =>
      main([dir, "--write"], { ...fakeDeps, ollama: { generateJson: async () => undefined } }),
    );
    assert.equal(written.value, 1, "Ollama unavailable => review");
    const after = JSON.parse(readFileSync(sidecar, "utf8")) as {
      status: string;
      qa: { failed: string[] };
    };
    assert.equal(after.status, "review");
    assert.deepEqual(after.qa.failed, ["title"]);
  });

  it("returns 2 when nothing matches", async () => {
    const run = await quiet(() => main(["/nonexistent/path/xyz"], fakeDeps));
    assert.equal(run.value, 2);
  });
});
