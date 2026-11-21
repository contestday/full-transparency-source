"use client";

import { useMemo, useState } from "react";
import { cn } from "@/components/ui";
import type { EventView } from "@/components/event-card";
import { addDays, eventDates, londonParts, toMinutes, weekdayOf } from "@/lib/events/rules";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ukTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/** The time an event runs on a given UK date, e.g. "18:00–22:00" or "from 19:00". */
function timesOn(e: EventView, date: string): string {
  if (e.recurrence) return `${e.recurrence.start_time}–${e.recurrence.end_time}`;
  const first = londonParts(Date.parse(e.starts_at)).date;
  const last = londonParts(Date.parse(e.ends_at) - 1).date;
  if (first === last) return `${ukTime(e.starts_at)}–${ukTime(e.ends_at)}`;
  if (date === first) return `from ${ukTime(e.starts_at)}`;
  if (date === last) return `until ${ukTime(e.ends_at)}`;
  return "all day";
}

/**
 * A month calendar of events (repeating ones on each of their days). Tap a
 * day to see what's on. UK dates.
 */
export function EventsCalendar({ events }: { events: EventView[] }) {
  const [today] = useState(() => londonParts(Date.now()).date);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);
  const live = useMemo(() => events.filter((e) => e.phase !== "cancelled"), [events]);

  const { days, byDay } = useMemo(() => {
    const first = `${month}-01`;
    const start = addDays(first, -((weekdayOf(first) + 6) % 7)); // back to Monday
    const days: string[] = [];
    for (let d = start; days.length < 42; d = addDays(d, 1)) days.push(d);
    const byDay = new Map<string, EventView[]>();
    for (const e of live) for (const d of eventDates(e, days[0], days[41])) byDay.set(d, [...(byDay.get(d) ?? []), e]);
    const startMin = (e: EventView) => (e.recurrence ? toMinutes(e.recurrence.start_time) : londonParts(Date.parse(e.starts_at)).minutes);
    for (const list of byDay.values()) list.sort((a, b) => startMin(a) - startMin(b));
    return { days, byDay };
  }, [month, live]);

  const [y, m] = month.split("-").map(Number);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
    setPicked(null);
  };
  const pickedEvents = picked ? (byDay.get(picked) ?? []) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" className="rounded border border-border bg-surface px-3 py-1.5 text-sm" onClick={() => shift(-1)} aria-label="Previous month">
          ←
        </button>
        <h3 className="min-w-40 text-center font-semibold">
          {MONTHS[m - 1]} {y}
        </h3>
        <button type="button" className="rounded border border-border bg-surface px-3 py-1.5 text-sm" onClick={() => shift(1)} aria-label="Next month">
          →
        </button>
        <button type="button" className="text-sm text-accent underline" onClick={() => setMonth(today.slice(0, 7))}>
          Today
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-slate-50 p-1.5 text-center text-xs font-semibold">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          return (
            <button
              type="button"
              key={d}
              onClick={() => setPicked(picked === d ? null : d)}
              aria-pressed={picked === d}
              aria-label={`${d}${items.length ? `, ${items.length} event${items.length === 1 ? "" : "s"}` : ""}`}
              className={cn("min-h-14 p-1 text-left align-top sm:min-h-20", inMonth ? "bg-surface" : "bg-slate-50 text-slate-400", picked === d && "ring-2 ring-inset ring-neutral-900")}
            >
              <span className={cn("text-xs", d === today && "inline-block rounded bg-accent px-1.5 text-white")}>{Number(d.slice(8))}</span>
              <span className="mt-0.5 hidden space-y-0.5 sm:block">
                {items.slice(0, 2).map((e) => (
                  <span key={e.reference} className="block truncate rounded bg-neutral-900 px-1 text-[11px] text-white" title={e.title}>
                    {e.title}
                  </span>
                ))}
                {items.length > 2 && <span className="block text-[11px] text-muted">+{items.length - 2} more</span>}
              </span>
              {items.length > 0 && (
                <span className="mt-1 flex gap-0.5 sm:hidden" aria-hidden="true">
                  {items.slice(0, 3).map((e) => (
                    <span key={e.reference} className="h-1.5 w-1.5 rounded-full bg-neutral-900" />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {picked && (
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="mb-1 font-semibold">{new Date(`${picked}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</p>
          {pickedEvents.length ? (
            <ul className="space-y-1">
              {pickedEvents.map((e) => (
                <li key={e.reference}>
                  <span className="tabular-nums">{timesOn(e, picked)}</span> · <strong>{e.title}</strong> · {e.places.map((p) => p.name).join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No events.</p>
          )}
        </div>
      )}
    </div>
  );
}
