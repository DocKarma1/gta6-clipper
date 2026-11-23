export default function RadarPage() {
  return (
    <>
      <section className="hero">
        <h1>Live Radar</h1>
        <p>
          This page will list every live GTA 6 stream on Twitch, ranked by viewers and chat
          hype. The Helix directory is not connected in this scaffold.
        </p>
      </section>
      <p className="notice">
        Attaching a clipper to someone else&apos;s stream will require a stored permission
        confirmation. Official Twitch APIs only — no unofficial access.
      </p>
      <table className="placeholder-table">
        <thead>
          <tr>
            <th>Streamer</th>
            <th>Viewers</th>
            <th>Hype</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={4}>No live directory yet. Wire Twitch Helix in Phase 1.</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
