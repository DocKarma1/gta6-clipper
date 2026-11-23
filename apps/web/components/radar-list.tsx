import type { LiveRadarResult } from "@gta6-clipper/shared";
import { StreamCard } from "./stream-card";

type RadarListProps = {
  result: LiveRadarResult;
};

const countFormat = new Intl.NumberFormat("en");
const VISIBLE_LIMIT = 100;

export function RadarList({ result }: RadarListProps) {
  if (result.streams.length === 0) {
    return (
      <div className="empty-state">
        <h2>No live GTA 6 streams right now</h2>
        <p className="muted">
          The {result.game.name} category is on Twitch, but nobody is live in it at the moment.
          Check back in a bit.
        </p>
      </div>
    );
  }

  const visible = result.streams.slice(0, VISIBLE_LIMIT);
  const remaining = result.streams.length - visible.length;

  return (
    <>
      <p className="radar-summary">
        {countFormat.format(result.streams.length)} live{" "}
        {result.streams.length === 1 ? "stream" : "streams"} in {result.game.name}, ranked by
        viewers
        {remaining > 0 ? `. Showing the top ${countFormat.format(visible.length)}.` : "."}
      </p>
      <section className="stream-grid">
        {visible.map((stream) => (
          <StreamCard key={stream.id} stream={stream} />
        ))}
      </section>
    </>
  );
}
