export default function LoginPage() {
  return (
    <section className="hero">
      <h1>Sign in</h1>
      <p className="lead">
        Placeholder page. Production auth is planned on Supabase Auth (free tier) with email and
        social providers such as Google or Twitch. No auth vendor is wired up in this scaffold, and
        no secrets belong in the repo.
      </p>
      <form action="#" method="post">
        <label>
          Email
          <input type="email" name="email" placeholder="you@example.com" disabled />
        </label>
        <button className="btn" type="button" disabled>
          Continue (not connected)
        </button>
      </form>
    </section>
  );
}
