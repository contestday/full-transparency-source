"use client";

import { useEffect, useState } from "react";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import type { PublicPlan } from "@/lib/public-data";
import type { MovementLog } from "@/lib/movement-log";
import { durationText } from "@/lib/area-visits";
import { planFactsOf, planLine } from "@/lib/plan-police";

/**
 * A period for a report: the plans published for it (past and coming up)
 * and the full movement record for it (every stay, journey and GPS reading,
 * home area included, up to now).
 */
export interface DateRange {
  from: string;
  to: string;
}

const DAY = 86_400_000;
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const today = () => dayKey(Date.now());
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return dayKey(d.getTime());
};

export const RANGE_PRESETS: { id: string; label: string; range: () => DateRange }[] = [
  { id: "last-week", label: "Last 7 days", range: () => ({ from: dayKey(Date.now() - 7 * DAY), to: today() }) },
  { id: "last-month", label: "Last month", range: () => ({ from: monthsAgo(1), to: today() }) },
  { id: "last-3-months", label: "Last 3 months", range: () => ({ from: monthsAgo(3), to: today() }) },
  { id: "next-6-weeks", label: "Next 6 weeks", range: () => ({ from: today(), to: dayKey(Date.now() + 42 * DAY) }) },
  { id: "both", label: "Last month and next 6 weeks", range: () => ({ from: monthsAgo(1), to: dayKey(Date.now() + 42 * DAY) }) },
];

/** The movement record covers up to this many days at once. */
export const MOVEMENT_DAYS = 184;

export const rangeText = (r: DateRange) => `${fmtDate(`${r.from}T12:00:00Z`)} to ${fmtDate(`${r.to}T12:00:00Z`)}`;
export const validRange = (r: DateRange) => /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && r.from <= r.to;
/** The past part of the range (movements can't be in the future), or null. */
export const pastPart = (r: DateRange): DateRange | null => (r.from > today() ? null : { from: r.from, to: r.to < today() ? r.to : today() });
const pastDays = (r: DateRange) => {
  const p = pastPart(r);
  return p ? Math.round((Date.parse(p.to) - Date.parse(p.from)) / DAY) + 1 : 0;
};

/** Published plans starting in the range. */
export async function loadPlansIn(r: DateRange): Promise<PublicPlan[]> {
  const res = await fetch(`/api/public/plans?from=${r.from}&to=${r.to}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the plans for those dates");
  return ((await res.json()) as { plans: PublicPlan[] }).plans;
}

/** The full movement record for the past part of the range. */
export async function loadMovementsIn(r: DateRange, token: string): Promise<MovementLog | null> {
  const p = pastPart(r);
  if (!p) return null;
  const res = await fetch(`/api/watch/${token}/movements?from=${p.from}&to=${p.to}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Could not load the movement record for those dates");
  return body as MovementLog;
}

const span = (from: string, until: string) =>
  fmtDate(from) === fmtDate(until) ? `${fmtDateTime(from)}–${fmtTime(until)}` : `${fmtDateTime(from)} – ${fmtDateTime(until)}`;
const pos = (lat: number | null, lng: number | null) => (lat == null || lng == null ? "" : ` (${lat.toFixed(5)}, ${lng.toFixed(5)})`);

export interface RangeFacts {
  plans: PublicPlan[];
  movement: MovementLog | null;
  loading: boolean;
  error: string | null;
}

/** Plans and the movement record for a range, reloaded when the range or choices change. */
export function useRangeFacts(r: DateRange, want: { plans: boolean; visits: boolean }, token: string | null): RangeFacts {
  const tooLong = want.visits && pastDays(r) > MOVEMENT_DAYS;
  const active = validRange(r) && !tooLong && (want.plans || (want.visits && Boolean(token)));
  const key = active ? `${r.from}|${r.to}|${want.plans}|${want.visits && Boolean(token)}|${token ?? ""}` : "";
  const [result, setResult] = useState<{ key: string; plans: PublicPlan[]; movement: MovementLog | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    const [from, to, p, v, tok] = key.split("|");
    let live = true;
    const t = setTimeout(() => {
      Promise.all([p === "true" ? loadPlansIn({ from, to }) : Promise.resolve([]), v === "true" ? loadMovementsIn({ from, to }, tok) : Promise.resolve(null)])
        .then(([plans, movement]) => live && setResult({ key, plans, movement, error: null }))
        .catch((e: Error) => live && setResult({ key, plans: [], movement: null, error: e.message }));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);
  if (tooLong)
    return {
      plans: [],
      movement: null,
      loading: false,
      error: `The full movement record covers up to ${MOVEMENT_DAYS} days up to today. Choose a shorter period.`,
    };
  if (!key) return { plans: [], movement: null, loading: false, error: null };
  if (result?.key !== key) return { plans: [], movement: null, loading: true, error: null };
  return { plans: result.plans, movement: result.movement, loading: false, error: result.error };
}

/** What the reporter chose to add for a period. */
export interface PeriodChoice {
  range: DateRange;
  plans: boolean;
  /** The full movement record: every stay, journey and GPS reading. */
  visits: boolean;
}

/** The name of the GPS readings file for a range. */
export const readingsFileBase = (r: DateRange) => {
  const p = pastPart(r) ?? r;
  return `gps-readings-${p.from}-to-${p.to}`;
};

/** The period's facts as report lines (headings in capitals). */
export function periodLines(c: PeriodChoice, f: RangeFacts, opts: { skipPlanId?: string } = {}): string[] {
  if (!validRange(c.range) || f.loading) return [];
  const out: string[] = [];
  if (c.plans) {
    const plans = f.plans.filter((p) => p.id !== opts.skipPlanId);
    out.push(`PUBLISHED PLANS, ${rangeText(c.range).toUpperCase()} (as published on the site)`);
    out.push(...(plans.length ? plans.map((p) => `  ${planLine(planFactsOf(p))}`) : ["  None published for these dates."]));
  }
  const m = f.movement;
  const past = pastPart(c.range);
  if (c.visits && m && past) {
    const when = rangeText(past).toUpperCase();
    const now = Date.now();
    if (out.length) out.push("");
    out.push(`EVERY STAY, ${when} (from the full GPS record, home area included)`);
    out.push(
      ...(m.stays.length
        ? m.stays.map((s) => `  ${span(s.from, s.until)} · ${durationText(s.from, s.until, now)} · ${s.place}${pos(s.lat, s.lng)}`)
        : ["  No stays recorded in these dates."]),
    );
    out.push("");
    out.push(`EVERY JOURNEY, ${when} (between one stay and the next)`);
    out.push(
      ...(m.journeys.length
        ? m.journeys.map(
            (j) =>
              `  ${span(j.from, j.until)} · ${durationText(j.from, j.until, now)} · ${j.fromPlace} to ${j.toPlace} · ${(j.distance_m / 1000).toFixed(1)} km · ${j.readings} GPS reading${j.readings === 1 ? "" : "s"}`,
          )
        : ["  No journeys recorded in these dates."]),
    );
    out.push("");
    out.push(`EVERY GPS READING, ${when}`);
    out.push(
      `  ${m.points.length.toLocaleString("en-GB")} readings, each with its time, position and accuracy, are in the file ${readingsFileBase(c.range)}.csv that goes with this report.${m.truncated ? " (The file stops at the first 120,000 readings: choose a shorter period for the rest.)" : ""}`,
    );
    out.push("  Near a private location (another person's home) a reading shows its time but no position; the address is available to police on request.");
  }
  return out;
}

/** Every GPS reading as CSV (time in UTC and UK time, position, accuracy). */
export function readingsCsv(m: MovementLog): string {
  const rows = ["time_utc,time_uk,latitude,longitude,accuracy_m,note"];
  for (const [at, lat, lng, acc] of m.points) {
    rows.push(
      [at, fmtDateTime(at), lat ?? "", lng ?? "", acc ?? "", lat == null ? "Private location: position held back; available to police on request" : ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
  }
  return rows.join("\r\n");
}
