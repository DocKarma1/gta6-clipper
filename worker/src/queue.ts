import { Queue, type ConnectionOptions } from "bullmq";
import { config } from "./config.js";

export const QUEUE_NAMES = {
  detect: "detect-spikes",
  clip: "render-clip",
  caption: "caption-clip",
  titles: "write-titles",
  publish: "publish-clip"
} as const;

export function redisConnection(): ConnectionOptions {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined
  };
}

export function makeQueue(name: string): Queue {
  return new Queue(name, { connection: redisConnection() });
}
