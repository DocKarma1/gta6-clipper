/**
 * Run the QA gate on clips that are already rendered and print a report.
 *
 *   npm run qa -- <clip dir | sidecar.json | clip.mp4 | clip id> [--write] [--json] [--no-ollama]
 *
 * Read-only by default. --write stores the result in each clip's sidecar JSON
 * (qa + status) on disk only; it never touches Supabase and never publishes.
 * Exit code: 0 all ready, 1 some need review, 2 usage error / nothing found.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadRepoEnv, type ClipQaSummary } from "@gta6-clipper/shared";
import { getQaSettings } from "./config";
import { runQaGate, statusFromQa, type QaDeps } from "./gate";
import { findSidecars, qaInputFromSidecar, readSidecar } from "./sidecar";

export type CliOptions = { targets: string[]; write: boolean; json: boolean; ollama: boolean };

export function parseArgs(argv: string[]): CliOptions | undefined {
  const options: CliOptions = { targets: [], write: false, json: false, ollama: true };
  for (const arg of argv) {
    if (arg === "--write") options.write = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--no-ollama") options.ollama = false;
    else if (arg === "--help" || arg === "-h") return undefined;
    else if (arg.startsWith("--")) return undefined;
    else options.targets.push(arg);
  }
  return options.targets.length ? options : undefined;
}

export function formatReport(name: string, qa: ClipQaSummary): string {
  const lines = [`${statusFromQa(qa) === "ready" ? "READY " : "REVIEW"}  ${name}`];
  if (!qa.enabled) lines.push("  QA gate is off (QA_GATE=off); clip is not publishable.");
  for (const check of qa.checks) {
    lines.push(`  ${check.passed ? "pass" : "FAIL"}  ${check.id}`);
    for (const reason of check.reasons) lines.push(`        - ${reason}`);
    const metrics = Object.entries(check.metrics)
      .filter(([, value]) => value !== null && value !== "")
      .map(
        ([key, value]) =>
          `${key}=${typeof value === "string" ? JSON.stringify(value) : String(value)}`,
      );
    if (metrics.length) lines.push(`        ${metrics.join("  ")}`);
  }
  return lines.join("\n");
}

const USAGE =
  "Usage: npm run qa -- <clip dir | sidecar.json | clip.mp4 | clip id> [--write] [--json] [--no-ollama]";

export async function main(argv: string[], deps: QaDeps = {}): Promise<number> {
  const options = parseArgs(argv);
  if (!options) {
    console.error(USAGE);
    return 2;
  }
  const root = loadRepoEnv();
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const clipsDir = path.join(path.resolve(root, process.env.DATA_DIR ?? "data"), "clips");
  const settings = {
    ...getQaSettings(),
    ...(options.ollama ? {} : { ollamaGroundingCheck: false }),
  };

  const files: string[] = [];
  for (const target of options.targets) {
    files.push(...(await findSidecars(path.resolve(baseDir, target), clipsDir)));
  }
  if (files.length === 0) {
    console.error(`No clip sidecars found for: ${options.targets.join(", ")}`);
    return 2;
  }

  let review = 0;
  const results: { sidecar: string; status: string; qa: ClipQaSummary }[] = [];
  for (const file of [...new Set(files)]) {
    const sidecar = await readSidecar(file);
    if (!sidecar) continue;
    const qa = await runQaGate(qaInputFromSidecar(file, sidecar), { ...deps, settings });
    const status = statusFromQa(qa);
    if (status !== "ready") review += 1;
    results.push({ sidecar: file, status, qa });
    if (!options.json) console.log(`${formatReport(path.basename(file, ".json"), qa)}\n`);
    if (options.write) {
      const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      const next = { ...raw, status, qa };
      await writeFile(`${file}.partial`, `${JSON.stringify(next, null, 2)}\n`);
      await rename(`${file}.partial`, file);
    }
  }
  if (options.json) console.log(JSON.stringify(results, null, 2));
  else {
    console.log(
      `${results.length - review} ready, ${review} to review${options.write ? " (sidecars updated)" : " (read-only; pass --write to store results in the sidecars)"}`,
    );
  }
  return review > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] && /qa[\\/]cli\.ts$/u.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : "QA run failed");
      process.exit(2);
    },
  );
}
