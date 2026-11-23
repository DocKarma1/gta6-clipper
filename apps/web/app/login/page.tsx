import Link from "next/link";
import { SignInForm } from "../../components/sign-in-form";
import { isSupabaseAuthConfigured } from "../../lib/auth-mode";
import { safeNextPath } from "../../lib/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  const configured = isSupabaseAuthConfigured();

  return (
    <section className="hero">
      <p className="badge">{configured ? "Supabase Auth" : "Local development mode"}</p>
      <h1>Sign in</h1>
      {params.error ? <p className="auth-error">{params.error.slice(0, 200)}</p> : null}
      {configured ? (
        <>
          <p className="lead">
            Use an email magic link or Twitch OAuth through your own Supabase project. This app
            never creates a hosted project or user account for you.
          </p>
          <SignInForm nextPath={nextPath} />
        </>
      ) : (
        <>
          <p className="lead">
            Supabase keys are not set, so authentication is skipped and dashboard routes stay open
            for local work. To enable sign-in later, create a Supabase project yourself and add
            these keys to <code>.env.local</code> (listed in <code>.env.example</code>):
          </p>
          <ul className="env-keys">
            <li>
              <code>NEXT_PUBLIC_SUPABASE_URL</code> — Project URL
            </li>
            <li>
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> — Project Settings → API → anon public
            </li>
            <li>
              <code>SUPABASE_SERVICE_ROLE_KEY</code> — service_role, worker/server only, never in
              the browser
            </li>
          </ul>
          <p className="muted">
            In the Supabase dashboard enable Email magic links and the Twitch provider, and add{" "}
            <code>{"{NEXT_PUBLIC_APP_URL}/auth/callback"}</code> to the redirect allow list. Do not
            paste those values into this repository.
          </p>
          <div className="row">
            <Link className="btn" href={nextPath}>
              Continue in local development mode
            </Link>
            <Link className="btn secondary" href="/">
              Back home
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
