import { NextResponse } from "next/server";
import {
  CAPTION_STYLE_IDS,
  evaluatePlanGate,
  isPlanId,
  type CaptionStyleId,
} from "@gta6-clipper/shared";

const ACTIONS = ["concurrent_streams", "clip", "caption_style", "ai_titles"] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

function isCaptionStyle(value: unknown): value is CaptionStyleId {
  return typeof value === "string" && (CAPTION_STYLE_IDS as readonly string[]).includes(value);
}

function asNonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!json || typeof json !== "object") {
    return NextResponse.json({ error: "Invalid plan gate request." }, { status: 400 });
  }
  const body = json as Record<string, unknown>;
  if (typeof body.planId !== "string" || !isPlanId(body.planId) || !isAction(body.action)) {
    return NextResponse.json({ error: "Invalid plan gate request." }, { status: 400 });
  }
  if (body.captionStyle !== undefined && !isCaptionStyle(body.captionStyle)) {
    return NextResponse.json({ error: "Unknown caption style." }, { status: 400 });
  }
  const currentConcurrentStreams = asNonNegativeInt(body.currentConcurrentStreams);
  const clipsThisMonth = asNonNegativeInt(body.clipsThisMonth);
  const result = evaluatePlanGate(body.planId, body.action, {
    ...(currentConcurrentStreams !== undefined ? { currentConcurrentStreams } : {}),
    ...(clipsThisMonth !== undefined ? { clipsThisMonth } : {}),
    ...(isCaptionStyle(body.captionStyle) ? { captionStyle: body.captionStyle } : {}),
  });
  const limits = {
    streamsAtOnce: result.plan.streamsAtOnce,
    clipsPerMonth: result.plan.clipsPerMonth,
    captionStyles: result.plan.captionStyles,
    aiTitles: result.plan.aiTitles,
  };
  if (!result.allowed) {
    return NextResponse.json(
      {
        allowed: false,
        planId: result.plan.id,
        limit: result.error.limit,
        message: result.error.message,
        limits,
      },
      { status: 402 },
    );
  }
  return NextResponse.json({ allowed: true, planId: result.plan.id, limits });
}
