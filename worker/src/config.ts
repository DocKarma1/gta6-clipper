import { getConfig } from "@gta6-clipper/shared";

export function getWorkerConfig() {
  const config = getConfig();
  return {
    redisUrl: config.REDIS_URL,
    concurrency: config.WORKER_CONCURRENCY,
    clipMaxSeconds: config.CLIP_MAX_SECONDS,
    whisperModel: config.WHISPER_MODEL,
    whisperDevice: config.WHISPER_DEVICE,
    whisperPython: config.WHISPER_PYTHON,
    llmBaseUrl: config.LLM_BASE_URL,
    llmModel: config.LLM_MODEL,
  };
}
