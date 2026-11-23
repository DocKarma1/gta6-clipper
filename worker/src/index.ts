import { getLogger } from "@gta6-clipper/shared";
import { getWorkerConfig } from "./config";
import { QUEUE_NAMES } from "./queue";

const log = getLogger("worker");

async function main(): Promise<void> {
  const config = getWorkerConfig();
  log.info(
    {
      redisHost: new URL(config.redisUrl).hostname,
      concurrency: config.concurrency,
      whisperModel: config.whisperModel,
      whisperDevice: config.whisperDevice,
      queues: Object.values(QUEUE_NAMES),
    },
    "GTA 6 Clipper worker scaffold. This process does not capture streams or render clips yet.",
  );
}

main().catch((error: unknown) => {
  log.error({ err: error }, "Worker failed to start");
  process.exitCode = 1;
});
