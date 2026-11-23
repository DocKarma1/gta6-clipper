import { readLocalClips, toPublicClip } from "../../server/clips";

export const dynamic = "force-dynamic";

export default function QueuePage() {
  const clips = readLocalClips(40).map(toPublicClip);
  const ready = clips.filter((clip) => clip.status === "ready").length;

  return (
    <>
      <section className="hero">
        <p className="badge">Clip Queue</p>
        <h1>Review clips before they go out</h1>
        <p>
          Local renders land here for title review and 1080×1920 download. Auto-post adapters stay
          stubs — nothing is published from this app.
        </p>
        <p className="muted">
          {clips.length === 0
            ? "No clips in the queue yet. Run the auto worker to capture and render moments."
            : `${ready} ready of ${clips.length} stored clips.`}
        </p>
      </section>
      {clips.length === 0 ? (
        <div className="empty-state">
          <h2>No clips in the queue yet</h2>
          <p className="muted">
            When the worker finishes a clip, it is saved locally and will show up here with a poster
            and a download button.
          </p>
        </div>
      ) : (
        <div className="queue-grid">
          {clips.map((clip) => (
            <article className="queue-card" key={clip.id}>
              {clip.hasPoster ? (
                <img
                  className="queue-poster"
                  src={`/api/clips/${clip.id}/file?kind=poster`}
                  alt={`${clip.channelLogin} clip poster`}
                />
              ) : (
                <div className="queue-poster placeholder">No poster</div>
              )}
              <div className="queue-body">
                <p className="queue-kicker">
                  {clip.channelLogin} · {clip.layout} · {clip.status}
                </p>
                <h2>{clip.hookTitle || "Untitled clip"}</h2>
                <p className="muted">
                  {Math.round(clip.durationSeconds)}s · {new Date(clip.createdAt).toLocaleString()}
                </p>
                {clip.errorMessage ? <p className="auth-error">{clip.errorMessage}</p> : null}
                {clip.hasVideo ? (
                  <a className="btn" href={`/api/clips/${clip.id}/file?kind=video`}>
                    Download 1080×1920 MP4
                  </a>
                ) : (
                  <p className="muted">File not available on this machine.</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
