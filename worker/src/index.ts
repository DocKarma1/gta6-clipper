import { config } from "./config.js";
import { QUEUE_NAMES } from "./queue.js";

async function main(): Promise<void> {
  console.log("GTA 6 Clipper worker scaffold");
  console.log("This process is a typed skeleton. It does not capture streams or render clips yet.");
  console.log(`Redis: ${config.redisUrl}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Whisper: model=${config.whisperModel} device=${config.whisperDevice}`);
  console.log(`Queues: ${Object.values(QUEUE_NAMES).join(", ")}`);
  console.log("See docs/PROJECT_PLAN.md for the build order. ffmpeg/Whisper belong on this VPS, not on Vercel.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
