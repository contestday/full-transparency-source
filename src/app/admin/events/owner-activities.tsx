"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import { ActivityForm, ActivityList } from "@/components/activities";
import type { ActivityInput, ActivityOption, ActivityView } from "@/lib/activities";

/** Activities I'm banned from: add one, see them, end one. Public (red), on the home, Events and watch pages. */
export function OwnerActivities({ activities, options }: { activities: ActivityView[]; options: ActivityOption[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = activities.filter((a) => a.status === "active");
  const ended = activities.filter((a) => a.status === "ended");

  async function add(input: ActivityInput): Promise<string | null> {
    const res = await fetch("/api/admin/activities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!res.ok) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save. Please try again.";
    setAdding(false);
    router.refresh();
    return null;
  }

  async function end(reference: string) {
    setError(null);
    const res = await fetch(`/api/admin/activities/${reference}`, { method: "DELETE" });
    if (!res.ok) return setError("Could not end it. Please try again.");
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Activities I&apos;m banned from <span className="text-muted">({live.length})</span>
        </h2>
        <Button onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "Add an activity I'm banned from"}</Button>
      </div>
      <p className="text-sm text-muted">Public: everyone sees them in red, on the home page, the Events page and every watch page.</p>
      {error && <Notice tone="red">{error}</Notice>}
      {adding && <ActivityForm options={options} withLevel={false} submitLabel="Add ban" submit={add} />}
      <ActivityList items={live} onEnd={end} empty="None." />
      {ended.length > 0 && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Ended ({ended.length})</summary>
          <div className="mt-3">
            <ActivityList items={ended} />
          </div>
        </details>
      )}
    </section>
  );
}
