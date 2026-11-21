"use client";

import { Field, Input, Select, cn } from "@/components/ui";
import { describeRecurrence, MONTHS, NTH_LABEL, seriesWindow, WEEKDAYS, weekdayOf, type Recurrence, type RepeatFreq } from "@/lib/events/rules";

/** The repeat being chosen in the form (Outlook-style). */
export interface RepeatDraft {
  freq: RepeatFreq;
  interval: number;
  days: number[];
  by: "day" | "nth";
  day: number;
  nth: number;
  weekday: number;
  month: number;
  start_time: string;
  end_time: string;
  first_date: string;
  end: "date" | "count" | "never";
  until: string;
  count: number;
}

export function newRepeat(firstDate = ""): RepeatDraft {
  const d = firstDate ? Number(firstDate.slice(8)) : 1;
  return {
    freq: "weekly",
    interval: 1,
    days: firstDate ? [weekdayOf(firstDate)] : [],
    by: "day",
    day: d,
    nth: Math.min(4, Math.ceil(d / 7)),
    weekday: firstDate ? weekdayOf(firstDate) : 1,
    month: firstDate ? Number(firstDate.slice(5, 7)) : 1,
    start_time: "18:00",
    end_time: "22:00",
    first_date: firstDate,
    end: "date",
    until: "",
    count: 10,
  };
}

export function draftToRecurrence(r: RepeatDraft): Recurrence {
  return {
    freq: r.freq,
    interval: r.interval,
    days: r.freq === "weekly" ? r.days : undefined,
    by: r.freq === "monthly" || r.freq === "yearly" ? r.by : undefined,
    day: r.day,
    nth: r.nth,
    weekday: r.weekday,
    month: r.month,
    start_time: r.start_time,
    end_time: r.end_time,
    anchor: r.first_date,
    count: r.end === "count" ? r.count : null,
    until: r.end === "date" ? r.until : null,
  };
}

/** What's sent to the server. */
export function draftToPayload(r: RepeatDraft) {
  return {
    freq: r.freq,
    interval: r.interval,
    days: r.freq === "weekly" ? r.days : undefined,
    by: r.by,
    day: r.day,
    nth: r.nth,
    weekday: r.weekday,
    month: r.month,
    start_time: r.start_time,
    end_time: r.end_time,
    first_date: r.first_date,
    end: r.end === "date" ? { type: "date", until: r.until } : r.end === "count" ? { type: "count", count: r.count } : { type: "never" },
  };
}

/** The first and last times, or a message saying what's missing. */
export function draftWindow(r: RepeatDraft): { startsAt: number; endsAt: number } | string {
  if (!r.first_date) return "Choose the start date.";
  if (r.freq === "weekly" && !r.days.length) return "Choose at least one day of the week.";
  if (!r.start_time || !r.end_time) return "Choose the times.";
  if (r.start_time === r.end_time) return "The end time must differ from the start time.";
  if (r.end === "date" && !r.until) return "Choose the end date, or another way to end.";
  if (r.end === "date" && r.until < r.first_date) return "The end date must be on or after the start date.";
  const w = seriesWindow(draftToRecurrence(r), r.first_date, { until: r.end === "date" ? r.until : null, count: r.end === "count" ? r.count : null });
  return w ?? "No day matches that repeat between those dates.";
}

const UNIT: Record<RepeatFreq, string> = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
const pill = (on: boolean) =>
  cn("h-10 rounded-xl border px-3 text-sm font-semibold", on ? "border-neutral-900 bg-neutral-900 text-white" : "border-border bg-white hover:bg-sky");

/** Daily / weekly / monthly / yearly, with every N, the days, the times and how it ends. */
export function RepeatPicker({ value: r, onChange, minDate }: { value: RepeatDraft; onChange: (r: RepeatDraft) => void; minDate: string }) {
  const set = (patch: Partial<RepeatDraft>) => onChange({ ...r, ...patch });
  const setFirst = (first: string) => {
    // Follow the start date for the day-of-month and weekday defaults.
    const d = Number(first.slice(8));
    set({
      first_date: first,
      day: first ? d : r.day,
      weekday: first ? weekdayOf(first) : r.weekday,
      nth: first ? Math.min(4, Math.ceil(d / 7)) : r.nth,
      month: first ? Number(first.slice(5, 7)) : r.month,
      days: r.freq === "weekly" && !r.days.length && first ? [weekdayOf(first)] : r.days,
    });
  };
  const n = r.interval;
  const summary = r.first_date ? describeRecurrence(draftToRecurrence(r), { end: true }) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Repeat">
        {(["daily", "weekly", "monthly", "yearly"] as RepeatFreq[]).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={r.freq === f} className={pill(r.freq === f)} onClick={() => set({ freq: f })}>
            {{ daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }[f]}
          </button>
        ))}
      </div>

      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Every</span>
        <Input
          type="number"
          min={1}
          max={99}
          value={n}
          onChange={(e) => set({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
          className="!w-20"
          aria-label="Every how many"
        />
        <span>
          {UNIT[r.freq]}
          {n === 1 ? "" : "s"}
        </span>
      </label>

      {r.freq === "weekly" && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">On</legend>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={r.days.includes(d)}
                onClick={() => set({ days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] })}
                className={cn(pill(r.days.includes(d)), "min-w-12")}
              >
                {WEEKDAYS[d].slice(0, 3)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {(r.freq === "monthly" || r.freq === "yearly") && (
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1.5 font-semibold">On</legend>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" checked={r.by === "day"} onChange={() => set({ by: "day" })} />
            {r.freq === "monthly" ? "Day" : "On"}
            <Input
              type="number"
              min={1}
              max={31}
              value={r.day}
              onChange={(e) => set({ by: "day", day: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })}
              className="!w-20"
              aria-label="Day of the month"
            />
            {r.freq === "yearly" && (
              <Select value={r.month} onChange={(e) => set({ by: "day", month: Number(e.target.value) })} className="!w-auto" aria-label="Month">
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
            {r.freq === "monthly" && <span className="text-muted">(shorter months: their last day)</span>}
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" checked={r.by === "nth"} onChange={() => set({ by: "nth" })} />
            The
            <Select value={r.nth} onChange={(e) => set({ by: "nth", nth: Number(e.target.value) })} className="!w-auto" aria-label="Which one">
              {[1, 2, 3, 4, -1].map((x) => (
                <option key={x} value={x}>
                  {NTH_LABEL[x]}
                </option>
              ))}
            </Select>
            <Select value={r.weekday} onChange={(e) => set({ by: "nth", weekday: Number(e.target.value) })} className="!w-auto" aria-label="Weekday">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {WEEKDAYS[d]}
                </option>
              ))}
            </Select>
            {r.freq === "yearly" && (
              <>
                of
                <Select value={r.month} onChange={(e) => set({ by: "nth", month: Number(e.target.value) })} className="!w-auto" aria-label="Month">
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </label>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From (time)" htmlFor="ev-rs" hint="UK time.">
          <Input id="ev-rs" type="time" required value={r.start_time} onChange={(e) => set({ start_time: e.target.value })} />
        </Field>
        <Field label="Until (time)" htmlFor="ev-re" hint="Earlier than the start means past midnight.">
          <Input id="ev-re" type="time" required value={r.end_time} onChange={(e) => set({ end_time: e.target.value })} />
        </Field>
        <Field label="Start date" htmlFor="ev-rf" hint="The first time must be at least 48 hours from now.">
          <Input id="ev-rf" type="date" required min={minDate} value={r.first_date} onChange={(e) => setFirst(e.target.value)} />
        </Field>
      </div>

      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1.5 font-semibold">Ends</legend>
        <label className="flex flex-wrap items-center gap-2">
          <input type="radio" checked={r.end === "date"} onChange={() => set({ end: "date" })} />
          On
          <Input type="date" min={r.first_date || minDate} value={r.until} onChange={(e) => set({ end: "date", until: e.target.value })} className="!w-auto" aria-label="End date" />
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="radio" checked={r.end === "count"} onChange={() => set({ end: "count" })} />
          After
          <Input
            type="number"
            min={1}
            max={999}
            value={r.count}
            onChange={(e) => set({ end: "count", count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
            className="!w-24"
            aria-label="Number of times"
          />
          times
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={r.end === "never"} onChange={() => set({ end: "never" })} />
          No end date
        </label>
      </fieldset>

      {summary && <p className="rounded-lg bg-slate-50 p-2 text-sm font-semibold">{summary}</p>}
    </div>
  );
}
