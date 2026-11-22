"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";

/** Police reporting on or off. Switching on asks first; switching off doesn't. */
export function PoliceReportsToggle({ initial }: { initial: boolean }) {
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
        <h2 className="text-lg font-semibold">Police reporting</h2>
        <Badge tone={enabled ? "green" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
      </div>
      <p className="text-sm text-muted">
        {enabled
          ? "On: the Report to police pages and buttons show on plans and watch pages."
          : "Off: every Report to police page and button is hidden from everyone."}
      </p>
      {error && <Notice tone="red">{error}</Notice>}
      {enabled ? (
        <Button variant="secondary" disabled={busy} onClick={() => set(false)}>
          Turn police reporting off
        </Button>
      ) : asking ? (
        <div className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-900" role="alert">
          <p>Turn police reporting on? Report to police buttons will show to everyone on plans and watch pages.</p>
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
          Turn police reporting on
        </Button>
      )}
    </Card>
  );
}
