"use client";

import { useState } from "react";
import { Button, Notice } from "@/components/ui";

/** One-button confirm/stop page: a button (not the link itself) acts, so email scanners can't. */
export function ContactAction({ action, token }: { action: "confirm" | "stop"; token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");
  async function go() {
    setState("busy");
    try {
      const r = await fetch(`/api/contacts/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: token }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong");
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setState("error");
    }
  }
  if (!token) return <Notice tone="red">This link is incomplete. Open it again from the email.</Notice>;
  if (state === "done")
    return (
      <Notice tone="green">
        {action === "confirm" ? "Confirmed. You'll receive the automatic reports. Every email has a link to stop them." : "Stopped. No more reports will be sent to this address."}
      </Notice>
    );
  return (
    <div className="space-y-3">
      {state === "error" && <Notice tone="red">{error}</Notice>}
      <Button onClick={() => void go()} disabled={state === "busy"} variant={action === "stop" ? "secondary" : "primary"}>
        {action === "confirm" ? "Confirm: send me the reports" : "Stop sending me reports"}
      </Button>
    </div>
  );
}
