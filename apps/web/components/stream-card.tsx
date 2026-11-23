import type { LiveStream } from "@gta6-clipper/shared";
import Image from "next/image";

const viewers = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

type StreamCardProps = {
  stream: LiveStream;
};

export function StreamCard({ stream }: StreamCardProps) {
  return (
    <article className="stream-card">
      <a className="stream-thumb" href={stream.url} target="_blank" rel="noopener noreferrer">
        <Image
          src={stream.thumbnailUrl}
          alt={`${stream.streamerName} live on Twitch`}
          width={640}
          height={360}
        />
        <span className="viewer-pill">{viewers.format(stream.viewerCount)} viewers</span>
      </a>
      <div className="stream-body">
        <div className="stream-meta">
          <a href={stream.url} target="_blank" rel="noopener noreferrer">
            {stream.streamerName}
          </a>
          {stream.language ? <span className="lang">{stream.language}</span> : null}
        </div>
        <p className="stream-title" title={stream.title}>
          {stream.title || "Untitled stream"}
        </p>
        <p className="muted login">
          <a href={stream.url} target="_blank" rel="noopener noreferrer">
            twitch.tv/{stream.streamerLogin}
          </a>
        </p>
      </div>
    </article>
  );
}
