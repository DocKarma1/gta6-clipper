import { isAppError, toUserMessage } from "@gta6-clipper/shared";
import { getLiveGta6Streams } from "@gta6-clipper/twitch";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const result = await getLiveGta6Streams();
    return NextResponse.json(result);
  } catch (error) {
    const status = isAppError(error) ? error.statusCode : 500;
    return NextResponse.json(
      {
        error: {
          code: isAppError(error) ? error.code : "INTERNAL_ERROR",
          message: toUserMessage(error),
        },
      },
      { status },
    );
  }
}
