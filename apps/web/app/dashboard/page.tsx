import Link from "next/link";
import { isSupabaseAuthConfigured } from "../../lib/auth-mode";
import { getSessionUser } from "../../lib/supabase/server";

export default async function DashboardPage() {
  const configured = isSupabaseAuthConfigured();
  const user = await getSessionUser();

  return (
    <section className="hero">
      <p className="badge">{configured ? "Dashboard" : "Dashboard · local development mode"}</p>
      <h1>Your clipping workspace</h1>
      <p>
        {configured
          ? user
            ? `Signed in as ${user.email ?? user.user_metadata?.preferred_username ?? user.id}.`
            : "You are signed in."
          : "Auth is off because Supabase keys are missing. The queue, import, and dashboard stay available so you can develop locally."}
      </p>
      <div className="row">
        <Link className="btn" href="/queue">
          Open clip queue
        </Link>
        <Link className="btn secondary" href="/radar">
          Live Radar
        </Link>
        {configured ? (
          <form action="/auth/sign-out" method="post">
            <button className="btn secondary" type="submit">
              Sign out
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
