import { RadarList } from "../../components/radar-list";
import { loadRadarData } from "../../server/streams";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RadarPage() {
  const data = await loadRadarData();

  return (
    <>
      <section className="hero">
        <p className="badge">Live Radar</p>
        <h1>GTA 6 on Twitch, right now</h1>
        <p>
          Live streams in the Grand Theft Auto VI category, ranked by viewer count. Chat-hype
          scoring arrives in a later phase.
        </p>
      </section>
      {data.ok ? (
        <RadarList result={data.result} />
      ) : (
        <div className="empty-state error-state">
          <h2>Could not load live streams</h2>
          <p className="muted">{data.message}</p>
        </div>
      )}
    </>
  );
}
