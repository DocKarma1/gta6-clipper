import { getAutoSettings, getLogger, getTwitchCredentials } from "@gta6-clipper/shared";
import { createClipperRepository } from "../repo/create";
import { createPermissionSource, loadPermissionPolicy } from "../permissions/source";
import { AutoPipeline } from "./pipeline";

const log = getLogger("worker.auto");

async function main(): Promise<void> {
  getTwitchCredentials();
  const settings = getAutoSettings();
  const permissions = createPermissionSource(settings);
  const policy = await loadPermissionPolicy(permissions, settings);
  if (policy.requirePermission && policy.permittedChannels.length === 0) {
    log.warn(
      "requirePermission is on and no streamer has a granted permission receipt, so no streams will be watched. Record receipts on /permissions, or switch requirePermission off on /settings.",
    );
  }
  const repository = createClipperRepository(settings.dataDir);
  const sampleOutputDir = process.env.AUTO_SAMPLE_DIR;
  const pipeline = new AutoPipeline({
    settings,
    repository,
    permissions,
    ...(sampleOutputDir ? { sampleOutputDir } : {}),
  });
  const shutdown = async () => {
    await pipeline.stop();
    repository.close?.();
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
