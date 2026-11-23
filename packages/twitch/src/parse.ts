import { getLogger, TwitchApiError } from "@gta6-clipper/shared";
import type { z } from "zod";

export function parseHelix<T>(schema: z.ZodType<T>, payload: unknown, context: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues.map((issue) => (issue.path.length > 0 ? issue.path.join(".") : "root")),
      ),
    ];
    getLogger("twitch.parse").warn({ context, fields }, "Helix response failed validation");
    throw new TwitchApiError(
      `Twitch ${context} response failed validation (${fields.join(", ")}).`,
      {
        statusCode: 502,
        code: "TWITCH_RESPONSE_INVALID",
      },
    );
  }
  return parsed.data;
}
