import { existsSync } from "node:fs";
import path from "node:path";

/** Path of an executable inside the repo's .venv (bin/ on macOS/Linux, Scripts\\*.exe on Windows). */
export function venvExecutable(root: string, name: string): string {
  return process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", `${name}.exe`)
    : path.join(root, ".venv", "bin", name);
}

/** The venv executable if it exists, otherwise the bare command name for PATH lookup. */
export function venvOrPath(root: string, name: string, fallback = name): string {
  const candidate = venvExecutable(root, name);
  return existsSync(candidate) ? candidate : fallback;
}
