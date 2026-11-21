"use client";

import { useMemo } from "react";
import { LazyMap } from "@/components/map-lazy";
import { eventFeatures, type EventView } from "@/components/event-card";
import { EventsCalendar } from "@/components/events-calendar";

export function AdminEventsMap({ events }: { events: EventView[] }) {
  const features = useMemo(() => eventFeatures(events), [events]);
  if (!features.length) return null;
  return <LazyMap features={features} fit className="h-[50vh] min-h-72 w-full rounded-lg" ariaLabel="Events on now and upcoming" />;
}

export function AdminEventsCalendar({ events }: { events: EventView[] }) {
  if (!events.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Calendar</h2>
      <EventsCalendar events={events} />
    </section>
  );
}
