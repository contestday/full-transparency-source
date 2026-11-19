"use client";

import { useState } from "react";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";

export interface ContactSettings {
  enabled: boolean;
  emails: string[];
  include_position: boolean;
  max_per_day: number;
  allow_watcher_contacts: boolean;
}

const parseEmails = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);

/** Admin → Settings: email chosen contacts when I enter an area set by a watcher. */
export function ContactAlertSettings({ initial, emailReady }: { initial: ContactSettings; emailReady: boolean }) {
  const [s, setS] = useState(initial);
  const [emailsText, setEmailsText] = useState(initial.emails.join("\n"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function save(next: ContactSettings) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ settings: ContactSettings }>("/api/admin/contact-alerts", { method: "PUT", json: next });
      setS(r.settings);
      setEmailsText(r.settings.emails.join("\n"));
      setMsg({ tone: "green", text: r.settings.enabled ? `Saved. Alerts are ON to ${r.settings.emails.length} address(es).` : "Saved. Alerts are off." });
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/contact-alerts", { method: "POST", json: { emails: parseEmails(emailsText) } });
      setMsg({ tone: "green", text: "Test email sent." });
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setBusy(false);
    }
  }

  const draft = { ...s, emails: parseEmails(emailsText) };
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">Contact alerts</h2>
        <p className="text-sm text-muted">
          When my GPS record shows I&apos;ve entered an area set by a watcher (including &ldquo;anywhere beyond home&rdquo;), emails go
          to the contacts that watcher chose (each confirmed by the recipient) and, if switched on below, to my own list. Emails only:
          nothing phones 999 or 101. Each email states the time, the area and that areas are set by anonymous members of the public.
        </p>
        {!emailReady && (
          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Email isn&apos;t set up on this site yet (the email service key and sender address on Vercel), so nothing can be sent.
          </p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={s.allow_watcher_contacts} onChange={(e) => setS({ ...s, allow_watcher_contacts: e.target.checked })} />
        Let watchers send automatic reports to contacts they choose
      </label>
      <p className="text-sm font-semibold">My own list</p>
      <Field label="Email addresses (one per line, up to 10)" htmlFor="contact-emails">
        <textarea
          id="contact-emails"
          rows={4}
          className="w-full rounded-lg border border-border bg-surface p-2 text-sm"
          value={emailsText}
          onChange={(e) => setEmailsText(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.include_position} onChange={(e) => setS({ ...s, include_position: e.target.checked })} />
        Include my exact GPS position and a map link in each email
      </label>
      <Field label="Most emails per day" htmlFor="contact-max">
        <Input
          id="contact-max"
          type="number"
          min={1}
          max={200}
          className="w-28"
          value={s.max_per_day}
          onChange={(e) => setS({ ...s, max_per_day: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })}
        />
      </Field>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        {s.enabled ? (
          <Button variant="secondary" disabled={busy} onClick={() => save({ ...draft, enabled: false })}>
            Turn alerts off
          </Button>
        ) : (
          <Button disabled={busy || !draft.emails.length} onClick={() => save({ ...draft, enabled: true })}>
            Save and turn alerts on
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => save(draft)}>
          Save
        </Button>
        <Button variant="ghost" disabled={busy || !draft.emails.length} onClick={() => void test()}>
          Send a test email
        </Button>
      </div>
    </Card>
  );
}
