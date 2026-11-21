"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LazyMap } from "@/components/map-lazy";
import { Card, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { EventCardBody, eventFeatures, type EventView } from "@/components/event-card";
import { EventsCalendar } from "@/components/events-calendar";
import { loadWatchLinks } from "@/lib/watch-links";

/**
 * The events on a watch link (this browser's saved link, or `token`), with a
 * map and a cancel button for each upcoming or current one.
 */
export function YourEvents({
  token: given,
  refreshKey = 0,
  title = "Your events",
  hideMap = false,
  onEvents,
}: {
  token?: string;
  refreshKey?: number;
  title?: string;
  hideMap?: boolean;
  /** Called with the events whenever they load (e.g. to draw them on another map). */
  onEvents?: (events: EventView[]) => void;
}) {
  const [token, setToken] = useState<string | null>(given ?? null);
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [ownerFirst, setOwnerFirst] = useState("I");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!given) setToken(loadWatchLinks()[0]?.token ?? null);
  }, [given]);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`/api/watch/${token}/events`, { cache: "no-store" });
    if (!res.ok) return setEvents([]);
    const body = (await res.json()) as { events: EventView[]; owner_first: string };
    setEvents(body.events);
    setOwnerFirst(body.owner_first);
    onEvents?.(body.events);
  }, [token, onEvents]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setEvents([]));
  }, [load, refreshKey]);

  const features = useMemo(() => eventFeatures(events ?? []), [events]);

  async function cancel(reference: string) {
    setError(null);
    const res = await fetch(`/api/watch/${token}/events/${reference}`, { method: "DELETE" });
    if (!res.ok) return setError("Could not cancel. Please try again.");
    await load();
  }

  if (!token || !events || !events.length) return null;
  const current = events.filter((e) => e.phase === "on" || e.phase === "upcoming");
  const past = events.filter((e) => e.phase === "ended" || e.phase === "cancelled");
  return (
    <section className="space-y-3" aria-labelledby="your-events">
      <h2 id="your-events" className="text-xl font-bold">
        {title}
      </h2>
      {error && <Notice tone="red">{error}</Notice>}
      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">Calendar</summary>
        <div className="mt-3">
          <EventsCalendar events={events} />
        </div>
      </details>
      {!hideMap && features.length > 0 && <LazyMap features={features} fit className="h-64 w-full rounded-lg" ariaLabel="Your events" />}
      {current.map((e) => (
        <Card key={e.reference}>
          <EventCardBody e={e} ownerFirst={ownerFirst}>
            <ConfirmButton size="sm" variant="secondary" confirmLabel="Yes, cancel it" onConfirm={() => cancel(e.reference)}>
              Cancel event
            </ConfirmButton>
          </EventCardBody>
        </Card>
      ))}
      {past.length > 0 && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Ended and cancelled ({past.length})</summary>
          <div className="mt-3 space-y-3">
            {past.map((e) => (
              <EventCardBody key={e.reference} e={e} ownerFirst={ownerFirst} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
