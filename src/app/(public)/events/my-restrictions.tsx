"use client";

import { useMemo } from "react";
import { LazyMap } from "@/components/map-lazy";
import { Card } from "@/components/ui";
import { EventCardBody } from "@/components/event-card";
import { EventsCalendar } from "@/components/events-calendar";
import { RESTRICTION_COLOR, restrictionFeatures, useRestrictions } from "@/components/restrictions";

/**
 * Where I mustn't go, for everyone: the events I'm banned from and my own
 * areas. If I'm in one, everyone sees red.
 */
export function MyRestrictions() {
  const r = useRestrictions();
  const features = useMemo(() => restrictionFeatures(r), [r]);
  if (!r) return null;
  const current = r.events.filter((e) => e.phase === "on" || e.phase === "upcoming");
  const past = r.events.filter((e) => e.phase === "ended");
  return (
    <section className="space-y-3" aria-labelledby="my-bans">
      <h2 id="my-bans" className="text-xl font-bold">
        Where I mustn&apos;t go
      </h2>
      <p className="text-sm text-muted">
        Events I&apos;m banned from, and my own restricted areas. Everyone can see these. If I&apos;m in one, the live marker shows red for everyone.
      </p>
      {!current.length && !r.areas.length && <p className="text-sm text-muted">Nothing at the moment.</p>}
      {features.length > 0 && <LazyMap features={features} fit className="h-64 w-full rounded-lg" ariaLabel="Where I mustn't go" />}
      {current.map((e) => (
        <Card key={e.reference} className="border-l-4" style={{ borderLeftColor: RESTRICTION_COLOR }}>
          <EventCardBody e={e} ownerFirst={r.owner_first} />
        </Card>
      ))}
      {r.areas.length > 0 && (
        <Card className="space-y-1 text-sm">
          <p className="font-semibold">My restricted areas (always)</p>
          <ul className="list-disc pl-5">
            {r.areas.map((a) => (
              <li key={a.reference}>{a.name || a.reference}</li>
            ))}
          </ul>
        </Card>
      )}
      {r.events.length > 0 && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Calendar</summary>
          <div className="mt-3">
            <EventsCalendar events={r.events} />
          </div>
        </details>
      )}
      {past.length > 0 && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Ended ({past.length})</summary>
          <div className="mt-3 space-y-3">
            {past.map((e) => (
              <EventCardBody key={e.reference} e={e} ownerFirst={r.owner_first} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
