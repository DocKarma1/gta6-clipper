export default function QueuePage() {
  return (
    <>
      <section className="hero">
        <h1>Clip Queue</h1>
        <p>
          Review detected spikes, edit captions and titles, then download a 1080p 9:16 file.
          Studio can auto-post approved clips after each platform API is authorized.
        </p>
      </section>
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
            <td colSpan={4}>Queue is empty until the worker pipeline is built (Phase 3).</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
