import { getLogger } from "@gta6-clipper/shared";
import type { z } from "zod";

const log = getLogger("worker.ollama");

export type OllamaOptions = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  /** Extra attempts after the first one (network errors or invalid JSON). */
  retries?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Small client for a local Ollama server (POST /api/chat). Responses are
 * requested as JSON and validated with Zod. Every failure returns undefined
 * so callers can fall back to templates; nothing here throws.
 */
export class OllamaClient {
  private available: { value: boolean; checkedAt: number } | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OllamaOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get model(): string {
    return this.options.model;
  }

  /** Probe /api/tags; cached for 60 s so an offline server costs one request a minute. */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.available && now - this.available.checkedAt < 60_000) return this.available.value;
    let value = false;
    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1_500),
      });
      value = response.ok;
    } catch {
      value = false;
    }
    if (!value && this.available?.value !== false) {
      log.info({ url: this.options.baseUrl }, "Ollama is not reachable; using template copy");
    }
    this.available = { value, checkedAt: now };
    return value;
  }

  async generateJson<T>(
    schema: z.ZodType<T>,
    input: { system: string; prompt: string; temperature?: number },
  ): Promise<T | undefined> {
    if (!(await this.isAvailable())) return undefined;
    const attempts = 1 + (this.options.retries ?? 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.options.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
          body: JSON.stringify({
            model: this.options.model,
            stream: false,
            format: "json",
            options: { temperature: input.temperature ?? 0.5, num_predict: 512 },
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: input.prompt },
            ],
          }),
        });
        if (!response.ok) {
          log.warn({ status: response.status, attempt }, "Ollama returned an error status");
          if (response.status === 404) return undefined; // model not pulled
          continue;
        }
        const payload = (await response.json()) as { message?: { content?: string } };
        const parsed = schema.safeParse(parseJsonObject(payload.message?.content ?? ""));
        if (parsed.success) return parsed.data;
        log.warn({ attempt }, "Ollama output did not match the expected JSON shape");
      } catch (error) {
        log.warn(
          { attempt, err: error instanceof Error ? error.name : "unknown" },
          "Ollama request failed",
        );
      }
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
    return undefined;
  }
}

export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
