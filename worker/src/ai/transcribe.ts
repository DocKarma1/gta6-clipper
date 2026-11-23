import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export type Word = { start: number; end: number; text: string };

export type Transcript = {
  text: string;
  words: Word[];
};

/**
 * Transcribe only the cut clip (seconds, not hours) via the local
 * faster-whisper helper. No paid caption API in the default path.
 */
export function transcribeClip(audioPath: string): Promise<Transcript> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(here, "../../scripts/transcribe.py");

  return new Promise((resolve, reject) => {
    const child = spawn(config.whisperPython, [
      script,
      audioPath,
      "--model",
      config.whisperModel,
      "--device",
      config.whisperDevice
    ]);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`transcribe.py exited ${code}: ${stderr || "not installed"}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Transcript);
      } catch (error) {
        reject(error);
      }
    });
  });
}
