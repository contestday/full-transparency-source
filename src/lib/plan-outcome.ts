// Did a plan happen? Pure helpers used by the publication job and the admin UI.

import { haversineMeters, type LatLng } from "@/lib/geo";

/** Statuses that still need an outcome once the plan's time has passed. */
export const OPEN_PLAN_STATUSES = ["planned", "confirmed", "changed"] as const;

/** Within this distance of a plan location counts as being there (as visit linking). */
export const PLAN_MATCH_RADIUS_M = 300;
/** Ask me this long after a plan ends if GPS hasn't confirmed it. */
export const ASK_AFTER_END_MS = 30 * 60_000;
/** Keep looking for GPS evidence (late uploads) for this long. */
export const VERIFY_FOR_MS = 14 * 24 * 3600_000;

export interface PlanTiming {
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}

/** When a plan is over: all-day plans run to the end of their (last) day; timed plans without an end get 2 hours. */
export function planEndMs(p: PlanTiming): number {
  const base = Date.parse(p.ends_at ?? p.starts_at);
  if (p.all_day) return base + 24 * 3600_000;
  return p.ends_at ? base : base + 2 * 3600_000;
}

export function isOpenStatus(status: string): boolean {
  return (OPEN_PLAN_STATUSES as readonly string[]).includes(status);
}

/** A plan whose time has passed but has no outcome yet. */
export function needsOutcome(p: PlanTiming & { status: string; archived?: boolean }, now: number): boolean {
  return !p.archived && isOpenStatus(p.status) && planEndMs(p) < now;
}

export interface Evidence {
  /** Raw GPS readings. */
  points: (LatLng & { t: number })[];
  /** Stays (including ones inferred from silence). */
  stays: (LatLng & { start: number; end: number })[];
}

/**
 * When the GPS record actually puts me at the plan's location(s) during the
 * plan (30 minutes' slack either side for arriving and leaving): arrival =
 * earliest matching stay start or reading, departure = latest. Null if never.
 */
export function gpsActualTimes(p: PlanTiming, locations: LatLng[], ev: Evidence): { start: number; end: number } | null {
  if (!locations.length) return null;
  const from = Date.parse(p.starts_at) - 30 * 60_000;
  const to = planEndMs(p) + 30 * 60_000;
  const near = (x: LatLng) => locations.some((l) => haversineMeters(l, x) <= PLAN_MATCH_RADIUS_M);
  const times: number[] = [];
  for (const o of ev.points) if (o.t >= from && o.t <= to && near(o)) times.push(o.t);
  for (const s of ev.stays) if (s.start <= to && s.end >= from && near(s)) times.push(s.start, s.end);
  return times.length ? { start: Math.min(...times), end: Math.max(...times) } : null;
}

/** True if the GPS record puts me at one of the plan's locations during the plan. */
export function gpsConfirmsPlan(p: PlanTiming, locations: LatLng[], ev: Evidence): boolean {
  return gpsActualTimes(p, locations, ev) !== null;
}
