export const config = {
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  clipMaxSeconds: Number(process.env.CLIP_MAX_SECONDS ?? 60),
  whisperModel: process.env.WHISPER_MODEL ?? "small",
  whisperDevice: process.env.WHISPER_DEVICE ?? "cpu",
  whisperPython: process.env.WHISPER_PYTHON ?? "python3",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434",
  llmModel: process.env.LLM_MODEL ?? "llama3.2"
};
