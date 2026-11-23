"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@gta6-clipper/shared/database-types";
import { isSupabaseAuthConfigured } from "../auth-mode";

export function createBrowserSupabase() {
  if (!isSupabaseAuthConfigured()) {
    throw new Error(
      "Supabase Auth is not configured. The app is running in local development mode.",
    );
  }
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
