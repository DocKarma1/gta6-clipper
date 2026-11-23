import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { renderVerticalShort } from "../src/export/render";
import type { TimedWord, VerticalLayout } from "@gta6-clipper/shared";

const OUT_DIR = "/workspace/gta6-clipper-samples";
const SOURCE = path.join(OUT_DIR, "layout-source.mp4");
const WORDS: TimedWord[] = [
  { start: 0.2, end: 0.55, text: "He" },
  { start: 0.55, end: 0.85, text: "did" },
  { start: 0.85, end: 1.15, text: "NOT" },
  { start: 1.15, end: 1.5, text: "just" },
  { start: 1.5, end: 1.9, text: "do" },
  { start: 1.9, end: 2.5, text: "that" },
];

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${binary} exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

async function makeSource(): Promise<void> {
  await run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1920x1080:rate=30:duration=4",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x1a5fb4:size=400x300:rate=30:duration=4",
    "-filter_complex",
    "[1:v]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='FACE':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2[cam];[0:v][cam]overlay=1480:40,format=yuv420p[vout]",
    "-map",
    "[vout]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    SOURCE,
  ]);
}

async function extractFrame(videoPath: string, pngPath: string): Promise<void> {
  await run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-ss",
    "1.6",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    pngPath,
  ]);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await makeSource();
  const layouts: { name: string; layout: VerticalLayout }[] = [
    {
      name: "stacked-split",
      layout: {
        layout: "stacked-split",
        facecam: { x: 1480, y: 40, width: 400, height: 300 },
      },
    },
    {
      name: "blurred-background",
      layout: { layout: "blurred-background", hookTitle: "HE DID WHAT?" },
    },
  ];
  for (const item of layouts) {
    const outputPath = path.join(OUT_DIR, `${item.name}.mp4`);
    const assOutputPath = path.join(OUT_DIR, `${item.name}.ass`);
    const pngPath = path.join(OUT_DIR, `${item.name}.png`);
    await renderVerticalShort({
      inputPath: SOURCE,
      outputPath,
      layout: item.layout,
      words: WORDS,
      credit: { login: "testdriver" },
      durationSeconds: 4,
      source: { width: 1920, height: 1080 },
      includeAudio: false,
      assOutputPath,
    });
    await extractFrame(outputPath, pngPath);
    await writeFile(
      path.join(OUT_DIR, `${item.name}.json`),
      JSON.stringify({ outputPath, pngPath, layout: item.layout.layout }, null, 2),
    );
    console.log(`wrote ${pngPath}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
