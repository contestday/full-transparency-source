"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";

/** Change my password. The server refuses short passwords and ones found in known breaches. */
export function PasswordSettings({ breached }: { breached: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(
    breached ? { tone: "red", text: "The password you signed in with has appeared in a data breach. Please choose a new one now." } : null,
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const password = String(f.get("new-password"));
    if (password !== String(f.get("confirm-password"))) return setMsg({ tone: "red", text: "The two passwords don't match." });
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; checked: boolean }>("/api/admin/password", { method: "PUT", json: { password } });
      form.reset();
      setMsg(
        r.checked
          ? { tone: "green", text: "Password changed. It isn't in any known data breach." }
          : { tone: "amber", text: "Password changed. The breach check couldn't be reached just now, so it wasn't checked." },
      );
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : "Couldn't change the password" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-5" id="password">
      <div>
        <h2 className="text-lg font-semibold">Change password</h2>
        <p className="text-sm text-muted">
          At least 12 characters. Passwords found in known data breaches are refused (checked with HaveIBeenPwned: only the first
          5 characters of a scrambled fingerprint leave this site, never the password).
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:max-w-md">
        <Field label="New password" htmlFor="new-password">
          <Input id="new-password" name="new-password" type="password" autoComplete="new-password" minLength={12} required />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm-password">
          <Input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" minLength={12} required />
        </Field>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Button type="submit" disabled={busy} className="w-fit">
          Change password
        </Button>
      </form>
    </Card>
  );
}
