import { type ConnectionOptions, Queue } from "bullmq";
import { getWorkerConfig } from "./config";

export const QUEUE_NAMES = {
  detect: "detect-spikes",
  clip: "render-clip",
  caption: "caption-clip",
  titles: "write-titles",
  publish: "publish-clip",
} as const;

export function redisConnection(): ConnectionOptions {
  const url = new URL(getWorkerConfig().redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
  };
}

export function makeQueue(name: string): Queue {
  return new Queue(name, { connection: redisConnection() });
}
