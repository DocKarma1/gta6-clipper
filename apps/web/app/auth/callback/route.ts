import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";
import { isSupabaseAuthConfigured } from "../../../lib/auth-mode";
import { safeNextPath } from "../../../lib/safe-next";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const nextPath = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");

  if (!isSupabaseAuthConfigured()) {
    return NextResponse.redirect(new URL(nextPath, url.origin));
  }

  const failed = (reason: string) => {
    const target = new URL("/login", url.origin);
    target.searchParams.set("error", reason);
    target.searchParams.set("next", nextPath);
    return NextResponse.redirect(target);
  };

  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) return failed(providerError.slice(0, 200));
  if (!code) return failed("Missing sign-in code. Request a new link.");

  const supabase = await createServerSupabase();
  if (!supabase) return failed("Supabase is not configured.");
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failed("The sign-in link expired or was already used. Request a new one.");

  return NextResponse.redirect(new URL(nextPath, url.origin));
}
