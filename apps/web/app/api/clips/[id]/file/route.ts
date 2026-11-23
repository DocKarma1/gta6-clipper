import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { isAllowedClipPath, readLocalClip } from "../../../../../server/clips";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = readLocalClip(id);
  if (!clip) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "poster" ? "poster" : "video";
  const filePath = kind === "poster" ? clip.posterPath : clip.outputPath;
  if (!filePath || !isAllowedClipPath(filePath) || !existsSync(filePath)) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  const stat = statSync(filePath);
  const stream = createReadStream(filePath);
  const headers = new Headers();
  headers.set("content-length", String(stat.size));
  if (kind === "poster") {
    headers.set("content-type", "image/png");
  } else {
    headers.set("content-type", "video/mp4");
    headers.set(
      "content-disposition",
      `attachment; filename="${clip.channelLogin}-${clip.id.slice(0, 8)}.mp4"`,
    );
  }
  return new NextResponse(Readable.toWeb(stream) as unknown as BodyInit, { headers });
}
