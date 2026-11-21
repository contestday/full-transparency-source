"use client";

import { useState } from "react";
import { Button, Notice, Textarea } from "@/components/ui";
import { api } from "@/lib/client-api";
import { WISH_LABELS, type WishKind } from "@/lib/plan-wishes";

/**
 * Give permission for a plan, or object to it. The reason is optional.
 * Only I see them (no counts are shown publicly).
 */
export function WishButtons({ planId }: { planId: string }) {
  const [open, setOpen] = useState<WishKind | null>(null);
  const [reason, setReason] = useState("");
  const [website, setWebsite] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [state, setState] = useState<"idle" | "sending" | { sent: WishKind } | { error: string }>("idle");

  function choose(kind: WishKind) {
    setOpen(open === kind ? null : kind);
    setStartedAt(Date.now());
    if (typeof state === "object") setState("idle");
  }

  async function send() {
    if (!open) return;
    setState("sending");
    try {
      await api(`/api/plans/${planId}/wish`, { method: "POST", json: { kind: open, reason: reason.trim() || undefined, form_started_at: startedAt, website } });
      setState({ sent: open });
      setOpen(null);
      setReason("");
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : "Could not send. Please try again." });
    }
  }

  const btn = (kind: WishKind) =>
    `inline-flex h-9 items-center gap-1.5 rounded-[var(--ft-radius-control)] border px-3 text-sm font-semibold ${
      open === kind ? "border-ink bg-ink text-white" : "border-border bg-white hover:bg-sky"
    }`;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn("permission")} aria-expanded={open === "permission"} onClick={() => choose("permission")}>
          Permission
        </button>
        <button type="button" className={btn("objection")} aria-expanded={open === "objection"} onClick={() => choose("objection")}>
          Objection
        </button>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg border border-hairline bg-white p-3">
          <label className="block text-sm font-semibold" htmlFor={`wish-${planId}`}>
            {open === "permission" ? "You give permission for this plan." : "You object to this plan."} Reason (optional)
          </label>
          <Textarea id={`wish-${planId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} />
          <input
            type="text"
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="hidden"
          />
          <p className="text-xs text-muted">Only I see this. No name needed.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={send} disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : `Send ${WISH_LABELS[open].toLowerCase()}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {typeof state === "object" && "sent" in state && <Notice tone="green">{WISH_LABELS[state.sent]} recorded. Thank you.</Notice>}
      {typeof state === "object" && "error" in state && <Notice tone="red">{state.error}</Notice>}
    </div>
  );
}
