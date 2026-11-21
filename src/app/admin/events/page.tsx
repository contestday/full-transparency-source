import { requirePageRole } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { loadAllEvents } from "@/lib/events/server";
import { loadOwnerProfile } from "@/lib/watchers";
import { EVENTS_NOTE } from "@/lib/events/rules";
import { createServiceClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { AdminEventsMap, AdminEventsCalendar } from "./events-map";
import { EventCardBody, type EventView } from "@/components/event-card";

export const dynamic = "force-dynamic";

/** Every watcher's events: upcoming, on now, and the record. Only I see these. */
export default async function AdminEventsPage() {
  await requirePageRole(["admin"]);
  const [events, owner] = await Promise.all([loadAllEvents(), loadOwnerProfile()]);
  const ids = events.map((e) => e.id);
  const { data: log } = ids.length
    ? await createServiceClient().from("watch_event_log").select("event_id, event_type, observed_at").in("event_id", ids).order("observed_at")
    : { data: [] };
  const logBy = new Map<string, { event_type: string; observed_at: string }[]>();
  for (const l of log ?? []) logBy.set(l.event_id, [...(logBy.get(l.event_id) ?? []), l]);
  const view = (e: (typeof events)[number]): EventView => ({ ...e, places: e.places });
  const on = events.filter((e) => e.phase === "on");
  const upcoming = events.filter((e) => e.phase === "upcoming");
  const past = events.filter((e) => e.phase === "ended" || e.phase === "cancelled").reverse();
  const section = (title: string, list: typeof events, empty: string) => (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        {title} <span className="text-muted">({list.length})</span>
      </h2>
      {!list.length && <p className="text-sm text-muted">{empty}</p>}
      {list.map((e) => (
        <Card key={e.id}>
          <EventCardBody e={view(e)} ownerFirst={owner.first}>
            <p className="text-xs text-muted">
              Set {fmtDateTime(e.created_at)}
              {e.cancelled_at ? ` · cancelled ${fmtDateTime(e.cancelled_at)}` : ""}
            </p>
            {(logBy.get(e.id) ?? []).length > 0 && (
              <ul className="text-xs tabular-nums">
                {(logBy.get(e.id) ?? []).map((l, i) => (
                  <li key={i}>
                    {l.event_type === "enter" ? "Entered" : "Left"} {fmtDateTime(l.observed_at)}
                  </li>
                ))}
              </ul>
            )}
          </EventCardBody>
        </Card>
      ))}
    </section>
  );
  return (
    <div className="space-y-8">
      <PageHeader title="Events" description="Places watchers would rather you weren't, for that time only. Shown in black, only to you and whoever set them." />
      <p className="text-sm text-muted">{EVENTS_NOTE}</p>
      <AdminEventsMap events={[...on, ...upcoming].map(view)} />
      <AdminEventsCalendar events={events.map(view)} />
      {section("On now", on, "None on now.")}
      {section("Upcoming", upcoming, "None upcoming.")}
      {section("Ended and cancelled", past, "None yet.")}
    </div>
  );
}
