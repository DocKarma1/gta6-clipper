import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  findRepoRoot,
  getConfig,
  getLogger,
  venvOrPath,
  type TimedWord,
} from "@gta6-clipper/shared";

const execFileAsync = promisify(execFile);
const log = getLogger("worker.transcribe");

export type Transcript = {
  text: string;
  language?: string;
  words: TimedWord[];
};

function resolvePython(): string {
  const configured = getConfig().WHISPER_PYTHON;
  if (configured && configured !== "python3") return configured;
  return venvOrPath(findRepoRoot(), "python", process.platform === "win32" ? "python" : "python3");
}

export function transcribeScriptPath(): string {
  return path.join(findRepoRoot(), "worker", "scripts", "transcribe.py");
}

export async function transcribeClip(
  audioPath: string,
  options: { model?: string; timeoutMs?: number } = {},
): Promise<Transcript> {
  const config = getConfig();
  const script = transcribeScriptPath();
  const python = resolvePython();
  if (!existsSync(script) || !existsSync(audioPath)) {
    return { text: "", words: [] };
  }
  try {
    const { stdout } = await execFileAsync(
      python,
      [
        script,
        audioPath,
        "--model",
        options.model ?? config.WHISPER_MODEL,
        "--device",
        config.WHISPER_DEVICE,
      ],
      { timeout: options.timeoutMs ?? 180_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as Transcript;
    const words = Array.isArray(parsed.words)
      ? parsed.words.filter(
          (word) =>
            typeof word.text === "string" &&
            word.text.trim().length > 0 &&
            typeof word.start === "number" &&
            typeof word.end === "number",
        )
      : [];
    return {
      text:
        typeof parsed.text === "string" ? parsed.text : words.map((word) => word.text).join(" "),
      ...(parsed.language ? { language: parsed.language } : {}),
      words,
    };
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : "unknown" },
      "Transcription failed; the clip will be rendered without captions",
    );
    return { text: "", words: [] };
  }
}
