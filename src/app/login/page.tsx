import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign-in", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/admin") ? sp.next : "/admin";
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-12">
      <Link href="/" className="mb-8 block">
        <span className="block text-lg font-bold">Full Transparency</span>
        <span className="block text-xs text-muted">Staff sign-in</span>
      </Link>
      {sp.error === "forbidden" && (
        <Notice tone="amber" className="mb-4">
          Your account does not have access. Ask the administrator to grant a role.
        </Notice>
      )}
      {!isSupabaseConfigured() ? (
        <Notice tone="red">Authentication is not configured (Supabase environment variables missing).</Notice>
      ) : (
        <LoginForm next={next} />
      )}
    </main>
  );
}
