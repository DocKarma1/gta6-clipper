import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLiveGta6Streams } from "@gta6-clipper/twitch";
import { getLogger, getTwitchCredentials } from "@gta6-clipper/shared";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defaultFacecamPython, defaultFacecamScript, FacecamDetector } from "../src/detect/facecam";

const execFileAsync = promisify(execFile);
const log = getLogger("worker.facecam.probe");

const SAMPLE_DIR =
  process.env.FACECAM_SAMPLE_DIR ?? "/workspace/gta6-clipper-samples/facecam-probe";
const LIMIT = Number(process.env.FACECAM_PROBE_LIMIT ?? 16);

async function download(url: string, dest: string): Promise<boolean> {
  const response = await fetch(url);
  if (!response.ok) return false;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < 1000) return false;
  await writeFile(dest, buffer);
  return true;
}

async function main(): Promise<void> {
  getTwitchCredentials();
  await mkdir(SAMPLE_DIR, { recursive: true });
  const live = await getLiveGta6Streams({ skipCache: true });
  const streams = live.streams.slice(0, LIMIT);
  const detector = new FacecamDetector();
  const python = defaultFacecamPython();
  const script = defaultFacecamScript();
  const rows: Array<Record<string, unknown>> = [];

  for (const stream of streams) {
    const login = stream.streamerLogin.toLowerCase();
    const large = stream.thumbnailUrl.replace(/\d+x\d+\.jpg/i, "1280x720.jpg");
    const imagePath = path.join(SAMPLE_DIR, `${login}.jpg`);
    const annotated = path.join(SAMPLE_DIR, `${login}-annotated.png`);
    const ok = await download(large, imagePath);
    if (!ok) {
      rows.push({ login, viewers: stream.viewerCount, error: "thumbnail-download-failed" });
      continue;
    }
    const detection = await detector.detectImage(imagePath);
    await execFileAsync(python, [script, imagePath, "--annotate", annotated]).catch(
      () => undefined,
    );
    rows.push({
      login,
      viewers: stream.viewerCount,
      title: stream.title,
      confidence: detection?.confidence ?? 0,
      method: detection?.method ?? null,
      rect: detection?.rect ?? null,
      accepted: Boolean(detection && detection.confidence >= 0.55),
      image: imagePath,
      annotated,
    });
  }

  const accepted = rows.filter((row) => row.accepted).length;
  const report = {
    sampled: rows.length,
    accepted,
    rejected: rows.length - accepted,
    acceptanceRate: rows.length ? accepted / rows.length : 0,
    rows,
  };
  await writeFile(path.join(SAMPLE_DIR, "report.json"), JSON.stringify(report, null, 2));
  log.info(
    { sampled: report.sampled, accepted, acceptanceRate: report.acceptanceRate },
    "Facecam thumbnail probe finished",
  );
}

main().catch((error) => {
  log.error({ err: error instanceof Error ? error.message : "unknown" }, "Facecam probe failed");
  process.exitCode = 1;
});
