"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";

/** Reporting (to the police or Crimestoppers) on or off. Switching on asks first; switching off doesn't. */
export function PoliceReportsToggle({ initial, watchersOn }: { initial: boolean; watchersOn: number }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ enabled: boolean }>("/api/admin/police-reports", { method: "POST", json: { enabled: next } });
      setEnabled(r.enabled);
      setAsking(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change it");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Reporting</h2>
        <Badge tone={enabled ? "green" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
      </div>
      <p className="text-sm text-muted">
        {enabled
          ? "On: each watcher can turn reporting on for their own watch link. Only they then see Report (their areas, and plans on their device), to send to the police or Crimestoppers."
          : "Off: nobody can use reporting, whatever they've chosen, and it isn't mentioned anywhere."}
      </p>
      <p className="text-sm">
        <span className="text-2xl font-bold tabular-nums">{watchersOn}</span>{" "}
        {watchersOn === 1 ? "watch link has" : "watch links have"} reporting turned on
        {!enabled && watchersOn > 0 ? " (not in use while this is off)" : ""}.
      </p>
      {error && <Notice tone="red">{error}</Notice>}
      {enabled ? (
        <Button variant="secondary" disabled={busy} onClick={() => set(false)}>
          Turn reporting off
        </Button>
      ) : asking ? (
        <div className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-900" role="alert">
          <p>Turn reporting on? Watchers will be able to turn it on for their own watch links. Nobody gets it unless they choose to.</p>
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
        <Button disabled={busy} onClick={() => setAsking(true)}>
          Turn reporting on
        </Button>
      )}
    </Card>
  );
}
