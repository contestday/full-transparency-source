"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";

type State = { exists: false } | { exists: true; locked: boolean; token: string };

/**
 * The public sample watch view (/sample). Create it, add its areas on its own
 * watch page, then lock it: from then on nobody can change it, and visitors
 * can open it from the menu.
 */
export function SampleWatcherSettings() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<State>("/api/admin/sample-watcher").then(setS).catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);
  async function act(action: "create" | "lock" | "unlock") {
    setError(null);
    try {
      setS(await api<State>("/api/admin/sample-watcher", { method: "POST", json: { action } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Sample</h2>
        {s?.exists && <Badge tone={s.locked ? "green" : "amber"}>{s.locked ? "Live at /sample (locked)" : "Being set up (not public yet)"}</Badge>}
      </div>
      <p className="text-sm text-muted">
        A real watch link that anyone can open from the menu (&ldquo;Sample&rdquo;), to see what a watcher sees compared
        with the public. Set up its areas first, then lock it: once locked, nothing on it can be added, changed or removed.
      </p>
      {error && <Notice tone="red">{error}</Notice>}
      {s && !s.exists && <Button onClick={() => act("create")}>Create the sample watch link</Button>}
      {s?.exists && (
        <div className="flex flex-wrap gap-2">
          {!s.locked && (
            <>
              <Link href={`/watch/${s.token}`} className="inline-flex h-11 items-center rounded-[var(--ft-radius-control)] border border-border bg-surface px-4 text-sm font-semibold hover:bg-sky">
                Open it to add areas →
              </Link>
              <Button onClick={() => act("lock")}>Lock and publish at /sample</Button>
            </>
          )}
          {s.locked && (
            <>
              <Link href="/sample" className="inline-flex h-11 items-center rounded-[var(--ft-radius-control)] border border-border bg-surface px-4 text-sm font-semibold hover:bg-sky">
                View /sample →
              </Link>
              <Button variant="secondary" onClick={() => act("unlock")}>Unlock to change it</Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
