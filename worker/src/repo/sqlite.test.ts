import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";
import type { ClipRecord } from "@gta6-clipper/shared";
import { SqliteClipRepository } from "./sqlite";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "clipper-repo-"));
  dirs.push(dir);
  return dir;
}

function clip(overrides: Partial<ClipRecord> = {}): ClipRecord {
  return {
    id: "clip-1",
    momentId: "moment-1",
    channelLogin: "ohnepixel",
    layout: "stacked-split",
    sourcePath: "/tmp/src.mp4",
    outputPath: "/tmp/out.mp4",
    posterPath: undefined,
    startedAt: "2026-11-23T15:34:23.100Z",
    durationSeconds: 15,
    hookTitle: "CHAT ANSWERED",
    status: "ready",
    errorMessage: undefined,
    createdAt: "2026-11-23T15:35:00.000Z",
    ...overrides,
  } as ClipRecord;
}

test("stores and reads back highlight timestamps", async () => {
  const repo = new SqliteClipRepository(tempDir());
  await repo.saveClip(
    clip({
      clipType: "question_reply",
      eventAt: "2026-11-23T15:34:25.600Z",
      peakAt: "2026-11-23T15:34:34.000Z",
      highlightStartAt: "2026-11-23T15:34:23.100Z",
      highlightEndAt: "2026-11-23T15:34:38.100Z",
      peakOffsetSeconds: 8.7,
      hypeScore: 72,
    }),
  );
  const [row] = await repo.listRecentClips(5);
  assert.equal(row?.clipType, "question_reply");
  assert.equal(row?.peakOffsetSeconds, 8.7);
  assert.equal(row?.hypeScore, 72);
  assert.equal(row?.highlightEndAt, "2026-11-23T15:34:38.100Z");
  repo.close();
});

test("upgrades an old database and marks interrupted renders", async () => {
  const dir = tempDir();
  const first = new SqliteClipRepository(dir);
  first.close();
  // Simulate an older schema without the highlight columns.
  const dbFile = path.join(dir, "clipper.sqlite");
  const raw = new DatabaseSync(dbFile);
  raw.exec("ALTER TABLE clips DROP COLUMN hype_score");
  raw.close();

  const repo = new SqliteClipRepository(dir);
  await repo.saveClip(clip({ id: "a", status: "rendering" }));
  await repo.saveClip(clip({ id: "b", status: "ready", hypeScore: 60 }));
  assert.equal(await repo.markInterruptedClips(), 1);
  const rows = await repo.listRecentClips(5);
  const a = rows.find((row) => row.id === "a");
  assert.equal(a?.status, "failed");
  assert.match(a?.errorMessage ?? "", /Interrupted/);
  assert.equal(rows.find((row) => row.id === "b")?.hypeScore, 60);
  repo.close();
});

test("stores the QA result and counts review clips toward the monthly quota", async () => {
  const repo = new SqliteClipRepository(tempDir());
  const qa = {
    version: 1 as const,
    enabled: true,
    passed: false,
    checkedAt: "2026-11-24T00:00:00.000Z",
    checks: [{ id: "title" as const, passed: false, reasons: ["template fallback"], metrics: {} }],
    failed: ["title" as const],
  };
  await repo.saveClip(clip({ status: "review", qa, errorMessage: "QA review: title" }));
  const [row] = await repo.listRecentClips(5);
  assert.equal(row?.status, "review");
  assert.deepEqual(row?.qa, qa);
  assert.equal(await repo.countClipsSince("2026-11-01T00:00:00.000Z"), 1);
  repo.close();
});
