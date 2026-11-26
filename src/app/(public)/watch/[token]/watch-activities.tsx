"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { ActivityForm, ActivityList } from "@/components/activities";
import type { ActivityInput, ActivityOption, ActivityView } from "@/lib/activities";

/**
 * Activities on a watch page: the ones I'm banned from (public, red), and this
 * link's own: activities you'd rather I didn't do (black, only you and me).
 */
export function WatchActivities({ token, sample = false }: { token: string; sample?: boolean }) {
  const [data, setData] = useState<{ activities: ActivityView[]; bans: ActivityView[]; options: ActivityOption[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/watch/${token}/activities`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setData(null));
  }, [load]);

  async function add(input: ActivityInput): Promise<string | null> {
    const res = await fetch(`/api/watch/${token}/activities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!res.ok) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save. Please try again.";
    setAdding(false);
    await load();
    return null;
  }

  async function end(reference: string) {
    setError(null);
    const res = await fetch(`/api/watch/${token}/activities/${reference}`, { method: "DELETE" });
    if (!res.ok) return setError("Could not end it. Please try again.");
    await load();
  }

  if (!data) return null;
  const current = data.activities.filter((a) => a.status === "active");
  const ended = data.activities.filter((a) => a.status === "ended");
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-labelledby="activity-bans">
        <h2 id="activity-bans" className="text-xl font-bold">
          Activities I&apos;m banned from
        </h2>
        <p className="text-sm text-muted">Everyone can see these.</p>
        <ActivityList items={data.bans} empty="None at the moment." />
      </section>
      {!sample && (
        <section className="space-y-3" aria-labelledby="my-activities">
          <h2 id="my-activities" className="text-xl font-bold">
            My activities
          </h2>
          <p className="text-sm text-muted">Something you&apos;d rather I didn&apos;t do. Shown in black, only to you and me. Not a legal order.</p>
          {error && <Notice tone="red">{error}</Notice>}
          <ActivityList items={current} onEnd={end} />
          {adding ? (
            <ActivityForm options={data.options} withLevel submitLabel="Add activity" submit={add} />
          ) : (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add an activity
            </Button>
          )}
          {ended.length > 0 && (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm font-semibold">Ended ({ended.length})</summary>
              <div className="mt-3">
                <ActivityList items={ended} />
              </div>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
