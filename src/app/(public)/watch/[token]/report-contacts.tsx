"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, Input, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { Icon } from "@/components/design";

interface Contact {
  id: string;
  email: string;
  confirmed: boolean;
  stopped: boolean;
}

/**
 * A watcher chooses where reports go when the tracked person enters their
 * areas: police contacts or anyone else (each address confirms first), plus
 * plain guidance for 999 and 101, which only a person can call.
 */
export function ReportContacts({ token }: { token: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/watch/${token}/contacts`, { cache: "no-store" });
    if (!r.ok) return;
    const body = (await r.json()) as { available: boolean; contacts: Contact[] };
    setAvailable(body.available);
    setContacts(body.contacts);
  }, [token]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/watch/${token}/contacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(body.error ?? "Couldn't add that address");
      setEmail("");
      setMsg({ tone: "green", text: "Added. We've emailed that address a link: reports start once they confirm." });
      await load();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : "Couldn't add that address" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/watch/${token}/contacts?id=${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <Card className="space-y-4 p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Icon name="chat" className="text-accent" /> Automatic reports
      </h2>
      <p className="text-sm text-muted">
        Choose who is emailed automatically when the GPS record shows entry into one of your areas: a police contact, a solicitor,
        or anyone else. Each address must confirm before it receives anything, and every email has a stop link.
      </p>

      {available === false ? (
        <Notice tone="amber">Automatic email reports aren&apos;t available at the moment.</Notice>
      ) : (
        <>
          {contacts.length > 0 && (
            <ul className="divide-y divide-hairline">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{c.email}</span>
                  <span className={c.stopped ? "text-[#C62828]" : c.confirmed ? "text-jade" : "text-muted"}>
                    {c.stopped ? "Stopped by recipient" : c.confirmed ? "Confirmed" : "Waiting for confirmation"}
                  </span>
                  <ConfirmButton prompt="Remove?" confirmLabel="Remove" onConfirm={() => remove(c.id)}>
                    Remove
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={add} className="flex flex-wrap gap-2">
            <label htmlFor="report-email" className="sr-only">
              Email address to receive reports
            </label>
            <Input
              id="report-email"
              type="email"
              required
              placeholder="e.g. a police contact's email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-0 flex-1 sm:text-base!"
            />
            <Button type="submit" disabled={busy || !email}>
              Add
            </Button>
          </form>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <p className="text-xs text-muted">
            The address you add is stored so reports can be sent. If you add your own address, the site can link it to this watch
            link, so you&apos;d no longer be fully anonymous.
          </p>
        </>
      )}

      <div className="space-y-2 rounded-xl bg-[#F1F4F8] p-4 text-sm">
        <p className="font-semibold">999 and 101</p>
        <p>
          These can only be called by a person. If you believe a crime is happening now or someone is in danger, <strong>call 999</strong>{" "}
          yourself. For non-emergencies in England, Wales or Scotland, call <strong>101</strong> or report online through your local
          police force.
        </p>
        <p className="text-muted">
          Areas on this site are concerns you&apos;ve chosen to watch, not court orders. When reporting, describe exactly what the GPS
          record shows and when.
        </p>
      </div>
    </Card>
  );
}
