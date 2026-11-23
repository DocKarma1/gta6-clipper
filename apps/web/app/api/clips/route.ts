import { NextResponse } from "next/server";
import { readLocalClips, toPublicClip } from "../../../server/clips";

export const runtime = "nodejs";

export async function GET() {
  const clips = readLocalClips(40).map(toPublicClip);
  return NextResponse.json({ clips });
}
