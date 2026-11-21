"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { EventCardBody, type EventView } from "@/components/event-card";
import { EventForm } from "@/app/(public)/events/event-form";

/** My own bans: add one, see them, cancel one. They're public (red). */
export function OwnerEvents({ events, ownerFirst }: { events: EventView[]; ownerFirst: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = events.filter((e) => e.phase === "on" || e.phase === "upcoming");

  async function cancel(reference: string) {
    setError(null);
    const res = await fetch(`/api/admin/events/${reference}`, { method: "DELETE" });
    if (!res.ok) return setError("Could not cancel. Please try again.");
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Events I&apos;m banned from <span className="text-muted">({live.length})</span>
        </h2>
        <Button onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "Add an event I'm banned from"}</Button>
      </div>
      <p className="text-sm text-muted">Public, like plans: everyone sees them in red, and while you&apos;re in one the live marker shows red for everyone.</p>
      {error && <Notice tone="red">{error}</Notice>}
      {adding && (
        <EventForm
          owner
          onAdded={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}
      {!live.length && <p className="text-sm text-muted">None.</p>}
      {live.map((e) => (
        <Card key={e.reference}>
          <EventCardBody e={e} ownerFirst={ownerFirst}>
            <ConfirmButton size="sm" variant="secondary" confirmLabel="Yes, cancel it" onConfirm={() => cancel(e.reference)}>
              Cancel
            </ConfirmButton>
          </EventCardBody>
        </Card>
      ))}
    </section>
  );
}
