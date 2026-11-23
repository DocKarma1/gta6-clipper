import { getAutoSettings, getLogger, getTwitchCredentials } from "@gta6-clipper/shared";
import { SqliteClipRepository } from "../repo/sqlite";
import { AutoPipeline } from "./pipeline";

const log = getLogger("worker.auto");

async function main(): Promise<void> {
  getTwitchCredentials();
  const settings = getAutoSettings();
  if (settings.requirePermission && settings.permittedChannels.length === 0) {
    log.warn(
      "requirePermission is true and AUTO_PERMITTED_CHANNELS is empty, so no streams will be watched. Set permitted channels, or explicitly set AUTO_REQUIRE_PERMISSION=false for a local write-only test run.",
    );
  }
  const repository = new SqliteClipRepository(settings.dataDir);
  const sampleOutputDir = process.env.AUTO_SAMPLE_DIR;
  const pipeline = new AutoPipeline({
    settings,
    repository,
    ...(sampleOutputDir ? { sampleOutputDir } : {}),
  });
  const shutdown = async () => {
    await pipeline.stop();
    repository.close();
    log.info(
      {
        channels: pipeline.getSelectedLogins(),
        moments: pipeline.moments.length,
        clips: pipeline.clips.length,
      },
      "Auto worker stopped",
    );
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
  await pipeline.start();
  if (settings.runSeconds) {
    setTimeout(() => {
      void shutdown().then(() => process.exit(0));
    }, settings.runSeconds * 1000);
  }
}

main().catch((error: unknown) => {
  log.error(
    { err: error instanceof Error ? error.message : "unknown" },
    "Auto worker failed to start",
  );
  process.exitCode = 1;
});
