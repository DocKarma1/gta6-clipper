"use client";

import { useState, type FormEvent } from "react";
import { createBrowserSupabase } from "../lib/supabase/browser";

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const redirectTo = () => {
    const origin = window.location.origin;
    const callback = new URL("/auth/callback", origin);
    callback.searchParams.set("next", nextPath || "/dashboard");
    return callback.toString();
  };

  async function onMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");
    try {
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo() },
      });
      if (error) throw error;
      setStatus("sent");
      setMessage(
        "Check your email for a magic link. This app does not create an account until you complete that link in a project you own.",
      );
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not send a magic link.");
    }
  }

  async function onTwitch() {
    setStatus("sending");
    setMessage("");
    try {
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "twitch",
        options: { redirectTo: redirectTo() },
      });
      if (error) throw error;
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not start Twitch sign-in.");
    }
  }

  return (
    <div className="auth-panel">
      <form onSubmit={onMagicLink}>
        <label>
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button className="btn" type="submit" disabled={status === "sending"}>
          {status === "sending" ? "Sending…" : "Email me a magic link"}
        </button>
      </form>
      <button
        className="btn secondary"
        type="button"
        onClick={() => void onTwitch()}
        disabled={status === "sending"}
      >
        Continue with Twitch
      </button>
      {message ? <p className={status === "error" ? "auth-error" : "muted"}>{message}</p> : null}
    </div>
  );
}
