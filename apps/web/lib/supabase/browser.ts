"use client";

import { createBrowserClient } from "@supabase/ssr";
import { isSupabaseAuthConfigured } from "../auth-mode";

export function createBrowserSupabase() {
  if (!isSupabaseAuthConfigured()) {
    throw new Error(
      "Supabase Auth is not configured. The app is running in local development mode.",
    );
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
