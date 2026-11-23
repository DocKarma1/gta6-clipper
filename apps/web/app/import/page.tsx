export default function ImportPage() {
  return (
    <section className="hero">
      <h1>YouTube import</h1>
      <p className="lead">
        Paste a long-form video you are allowed to use (up to 6 hours on Studio). The worker
        will look for peak moments and return Shorts through the same Clip Queue. This form
        is a placeholder — ingest is not enabled yet.
      </p>
      <form action="#" method="post">
        <label>
          YouTube URL
          <input type="url" name="url" placeholder="https://www.youtube.com/watch?v=" disabled />
        </label>
        <button className="btn" type="button" disabled>
          Import (not connected)
        </button>
      </form>
    </section>
  );
}
