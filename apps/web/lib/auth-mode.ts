/**
 * Auth is fail-safe: when Supabase public keys are missing the app runs in a
 * clearly marked local development mode and never talks to a hosted project.
 * No accounts are created from this repository.
 */
export function isSupabaseAuthConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && anon);
}

export const LOCAL_DEV_AUTH_MESSAGE =
  "Local development mode — Supabase Auth is not configured. Sign-in is skipped. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example) to enable email magic links and Twitch OAuth.";

export const SUPABASE_AUTH_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
