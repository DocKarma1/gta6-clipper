import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <p className="badge">Starter scaffold</p>
        <h1>Cut the moment chat loses it — while the stream is still live.</h1>
        <p>
          GTA 6 Clipper watches live Twitch chats, finds the spikes, and turns them into vertical
          1080p Shorts with captions. Review everything in a queue. On Studio, auto-post to TikTok,
          YouTube Shorts, Instagram Reels, and Facebook.
        </p>
        <div className="row">
          <Link className="btn" href="/radar">
            Open Live Radar
          </Link>
          <Link className="btn secondary" href="/pricing">
            View plans
          </Link>
        </div>
      </section>
      <section className="grid">
        <article className="card">
          <h2>Live Radar</h2>
          <p className="muted">
            Every live GTA 6 stream on Twitch, ranked by viewers and chat hype. Attach up to ten
            streams on Studio.
          </p>
        </article>
        <article className="card">
          <h2>Spike to Short</h2>
          <p className="muted">
            Laughs, “CLIP IT”, and emote floods become a 9:16 cut. Captions and titles run on
            self-hosted Whisper and a local or free-tier LLM.
          </p>
        </article>
        <article className="card">
          <h2>Built to stay cheap</h2>
          <p className="muted">
            Official APIs, Supabase and R2 free tiers, and an always-on VPS for ffmpeg. Read the
            costs section in the project plan before you deploy.
          </p>
        </article>
      </section>
    </>
  );
}
