import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Exchanges the magic-link code for a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/admin";
  const next = nextParam.startsWith("/admin") ? nextParam : "/admin";
  if (code) {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
