export default function QueuePage() {
  return (
    <>
      <section className="hero">
        <p className="badge">Clip Queue</p>
        <h1>Review clips before they go out</h1>
        <p>
          Detected spikes will land here for caption edits, title review, and 1080p download.
          Auto-post stays on the Studio plan once destination APIs are approved.
        </p>
      </section>
      <div className="empty-state">
        <h2>No clips in the queue yet</h2>
        <p className="muted">
          The clipping worker is not wired up in this phase. Live Radar is available now; chat-spike
          detection and rendering come next.
        </p>
        <table className="placeholder-table">
          <thead>
            <tr>
              <th>Clip</th>
              <th>Hype</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4}>Waiting for the worker pipeline (later phase).</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
