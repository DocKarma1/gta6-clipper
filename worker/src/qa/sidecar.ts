import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { QaCopy } from "./checks";
import type { QaClipInput } from "./gate";

/** The parts of the clip sidecar JSON (auto/clip-job.ts) the gate needs. */
export type ClipSidecar = {
  version?: number;
  clipId?: string;
  channelLogin?: string;
  credit?: string;
  files?: { video?: string; thumbnail?: string | null; captions?: string | null };
  highlight?: { reasons?: string[]; question?: { text?: string } | null };
  copy?: QaCopy[];
  transcript?: string;
  status?: string;
  qa?: unknown;
};

export function isClipSidecar(value: unknown): value is ClipSidecar {
  if (!value || typeof value !== "object") return false;
  const v = value as ClipSidecar;
  return typeof v.channelLogin === "string" && typeof v.files?.video === "string";
}

/** Build gate input from a sidecar on disk (paths resolved next to the sidecar). */
export function qaInputFromSidecar(sidecarPath: string, sidecar: ClipSidecar): QaClipInput {
  const dir = path.dirname(sidecarPath);
  const base = sidecarPath.replace(/\.json$/u, "");
  const videoPath = path.join(dir, sidecar.files?.video ?? `${path.basename(base)}.mp4`);
  const captions = sidecar.files?.captions ? path.join(dir, sidecar.files.captions) : `${base}.ass`;
  const login = sidecar.channelLogin ?? "";
  return {
    videoPath,
    ...(existsSync(captions) ? { assPath: captions } : {}),
    channelLogin: login,
    transcript: sidecar.transcript ?? "",
    reasons: sidecar.highlight?.reasons ?? [],
    questionText: sidecar.highlight?.question?.text,
    copy: sidecar.copy ?? [],
    credit: sidecar.credit ?? (login ? `twitch.tv/${login}` : undefined),
  };
}

export async function readSidecar(filePath: string): Promise<ClipSidecar | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return isClipSidecar(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a CLI target to sidecar paths: a sidecar .json, a clip .mp4 (its
 * sibling .json), a directory (every sidecar in it), or a clip id / id prefix
 * searched in `clipsDir`.
 */
export async function findSidecars(target: string, clipsDir: string): Promise<string[]> {
  const info = await stat(target).catch(() => undefined);
  if (info?.isDirectory()) return sidecarsIn(target);
  if (info?.isFile()) {
    if (target.endsWith(".json")) return [target];
    const sibling = target.replace(/\.[^./\\]+$/u, ".json");
    return existsSync(sibling) ? [sibling] : [];
  }
  // Treat as a clip id (full UUID or the 8-char prefix in the filename).
  const id = path.basename(target).toLowerCase();
  if (!/^[0-9a-f-]{6,36}$/u.test(id)) return [];
  const all = await sidecarsIn(clipsDir);
  const matches: string[] = [];
  for (const file of all) {
    if (path.basename(file).toLowerCase().includes(id.slice(0, 8))) {
      const sidecar = await readSidecar(file);
      if (!sidecar?.clipId || sidecar.clipId.toLowerCase().startsWith(id)) matches.push(file);
    }
  }
  return matches;
}

async function sidecarsIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  const out: string[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (await readSidecar(full)) out.push(full);
  }
  return out;
}
