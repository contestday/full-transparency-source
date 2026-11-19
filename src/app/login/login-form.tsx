"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);

  async function signInPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg(null);
    const { error } = await createBrowserSupabase().auth.signInWithPassword({
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    if (error) {
      setBusy(false);
      setMsg({ tone: "red", text: "Sign-in failed. Check your email and password." });
      return;
    }
    // If this password appears in a known breach, go straight to changing it.
    const check = await fetch("/api/admin/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: String(f.get("password")) }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ breached: boolean }>) : { breached: false }))
      .catch(() => ({ breached: false }));
    setBusy(false);
    if (check.breached) {
      router.replace("/admin/settings?password=breached#password");
      router.refresh();
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function sendMagicLink(email: string) {
    if (!email) {
      setMsg({ tone: "red", text: "Enter your email address first." });
      return;
    }
    setBusy(true);
    const { error } = await createBrowserSupabase().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    setMsg(error ? { tone: "red", text: "Could not send link." } : { tone: "green", text: "Check your email for a sign-in link." });
  }

  return (
    <Card>
      <form onSubmit={signInPassword} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" />
        </Field>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Button type="submit" className="w-full" disabled={busy}>
          Sign in
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={busy}
          onClick={(e) => {
            const email = (e.currentTarget.form?.elements.namedItem("email") as HTMLInputElement | null)?.value ?? "";
            void sendMagicLink(email);
          }}
        >
          Email me a sign-in link
        </Button>
      </form>
    </Card>
  );
}
