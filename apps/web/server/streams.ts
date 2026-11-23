import "server-only";

import { isAppError, toUserMessage, type LiveRadarResult } from "@gta6-clipper/shared";
import { getLiveGta6Streams } from "@gta6-clipper/twitch";

export type RadarPageData =
  { ok: true; result: LiveRadarResult } | { ok: false; message: string; code: string };

export async function loadRadarData(): Promise<RadarPageData> {
  try {
    const result = await getLiveGta6Streams();
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      message: toUserMessage(error),
      code: isAppError(error) ? error.code : "INTERNAL_ERROR",
    };
  }
}
