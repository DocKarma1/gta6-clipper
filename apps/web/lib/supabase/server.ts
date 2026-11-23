import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@gta6-clipper/shared";
import { isSupabaseAuthConfigured } from "../auth-mode";

export async function createServerSupabase() {
  if (!isSupabaseAuthConfigured()) {
    return null;
  }
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component where cookies are read-only.
          }
        },
      },
    },
  );
}

export async function getSessionUser() {
  const supabase = await createServerSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
