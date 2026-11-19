"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { api } from "@/lib/client-api";

export function JobButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function run(job: "followmee" | "publish") {
    setBusy(job);
    setMsg(null);
    try {
      const r = await api<Record<string, unknown>>(`/api/admin/publication/run?job=${job}`, { method: "POST" });
      setMsg(job === "followmee" ? `Poll OK: ${String(r.inserted ?? 0)} new` : "Publication processed");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run("followmee")}>
        {busy === "followmee" ? "Polling…" : "Poll FollowMee now"}
      </Button>
      <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run("publish")}>
        {busy === "publish" ? "Processing…" : "Run publication"}
      </Button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
