import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";
import { isSupabaseAuthConfigured } from "../../../lib/auth-mode";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const nextPath = url.searchParams.get("next")?.startsWith("/")
    ? url.searchParams.get("next")!
    : "/dashboard";
  const code = url.searchParams.get("code");

  if (!isSupabaseAuthConfigured()) {
    return NextResponse.redirect(new URL(nextPath, url.origin));
  }

  if (code) {
    const supabase = await createServerSupabase();
    if (supabase) {
      await supabase.auth.exchangeCodeForSession(code);
    }
  }

  return NextResponse.redirect(new URL(nextPath, url.origin));
}
