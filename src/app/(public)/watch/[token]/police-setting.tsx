"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Notice } from "@/components/ui";
import { Icon } from "@/components/design";

type State = { available: boolean; enabled: boolean };

/**
 * The watcher's own choice to turn police reporting on for this watch link.
 * Shows nothing at all while police reporting is switched off site-wide.
 * Turning it on asks first; turning it off doesn't.
 */
export function PoliceSetting({ token }: { token: string }) {
  const [s, setS] = useState<State | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/watch/${token}/police-reports`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: State | null) => setS(v))
      .catch(() => setS(null));
  }, [token]);

  async function set(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/watch/${token}/police-reports`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error ?? "Could not change it");
      setS(body as State);
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change it");
    } finally {
      setBusy(false);
    }
  }

  if (!s?.available) return null;
  return (
    <Card className="space-y-3 p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Icon name="info" className="text-accent" /> Police reporting
      </h2>
      {s.enabled ? (
        <>
          <p className="text-sm">
            <strong>On</strong> for this watch link. You can prepare a report about one of your areas, or about a plan, and send it to the
            police yourself.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/watch/${token}/police`}
              className="inline-flex h-11 items-center rounded-[var(--ft-radius-control)] border border-border bg-surface px-4 text-sm font-semibold hover:bg-sky"
            >
              Report to police →
            </Link>
            <Button variant="secondary" disabled={busy} onClick={() => set(false)}>
              Turn off
            </Button>
          </div>
        </>
      ) : asking ? (
        <div className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-900" role="alert">
          <p className="font-semibold">Turn on police reporting for this watch link?</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>You&apos;ll get a Report to police page for your areas, and a Report to police button on plans, on this device.</li>
            <li>The site fills in only what the GPS record shows. You write your concern in your own words.</li>
            <li>You send the report yourself. The site never contacts the police.</li>
            <li>Making a false report to the police is an offence.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={busy} onClick={() => set(true)}>
              Yes, turn it on
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">Off. Turn it on if you want to be able to report a movement to the police yourself.</p>
          <Button disabled={busy} onClick={() => setAsking(true)}>
            Turn on police reporting
          </Button>
        </>
      )}
      {error && <Notice tone="red">{error}</Notice>}
    </Card>
  );
}
