import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "GTA 6 Clipper",
  description:
    "Watch live GTA 6 Twitch chats, cut spike moments to 9:16, and export 1080p Shorts. Original starter project.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/" style={{ color: "var(--text)", fontWeight: 700 }}>
            GTA 6 Clipper
          </Link>
          <nav>
            <Link href="/radar">Live Radar</Link>
            <Link href="/queue">Clip Queue</Link>
            <Link href="/import">Import</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/login">Sign in</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          Independent project — not affiliated with Rockstar Games or Take-Two Interactive. Only
          clip streams you have permission to use.{" "}
          <a href="https://github.com/DocKarma1/gta6-clipper/blob/main/docs/PROJECT_PLAN.md">
            Project plan
          </a>
        </footer>
      </body>
    </html>
  );
}
