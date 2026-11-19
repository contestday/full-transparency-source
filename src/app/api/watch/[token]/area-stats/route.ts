import { handle, HttpError, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { findWatcher } from "@/lib/watchers";
import { loadWatchAreas } from "@/lib/watch-areas";
import { flaggedPeriods, type EvidenceEvent } from "@/lib/area-visits";
import { londonDayKey } from "@/lib/format";
import { shiftDay } from "@/lib/history-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };
const DAYS = 30;

/**
 * For each of this watcher's areas, the last 30 days: how many times I was
 * recorded in it, for how long, and minutes per day (for a small bar chart).
 * From recorded entries and exits only; times, never positions.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-area-stats:min", windowSeconds: 60, max: 20 }]);
  const { token } = await ctx.params;
  const upper = token.toUpperCase();
  const w = await findWatcher(upper);
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");

  const areas = await loadWatchAreas(w.id, upper);
  const today = londonDayKey(new Date().toISOString());
  const firstDay = shiftDay(today, -(DAYS - 1));
  const since = Date.parse(`${firstDay}T00:00:00Z`) - 3_600_000;
  const now = Date.now();
  const ids = areas.map((a) => a.id);
  const supabase = createServiceClient();
  const [{ data: events }, { data: states }] = await Promise.all([
    ids.length
      ? supabase
          .from("geofence_events")
          .select("geofence_id, event_type, observed_at")
          .in("geofence_id", ids)
          .in("event_type", ["enter", "exit"])
          .gte("observed_at", new Date(since).toISOString())
          .order("observed_at", { ascending: true })
          .limit(10000)
      : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("geofence_state").select("geofence_id, inside").in("geofence_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const insideNow = new Map(((states ?? []) as { geofence_id: string; inside: boolean }[]).map((s) => [s.geofence_id, Boolean(s.inside)]));

  const stats = areas.map((a) => {
    const evs: EvidenceEvent[] = ((events ?? []) as { geofence_id: string; event_type: string; observed_at: string }[])
      .filter((e) => e.geofence_id === a.id)
      .map((e) => ({ type: e.event_type as "enter" | "exit", at: e.observed_at, accuracy_m: null, reference: a.reference }));
    const periods = flaggedPeriods(evs, insideNow.get(a.id) ?? false).filter((p) => p.from);
    const perDay = Array.from({ length: DAYS }, () => 0);
    let minutes = 0;
    for (const p of periods) {
      const start = Math.max(Date.parse(p.from!), since);
      const end = p.until ? Date.parse(p.until) : p.ongoing ? now : start;
      if (!(end > start)) continue;
      minutes += Math.round((end - start) / 60_000);
      // Count each period on the day it began.
      const idx = DAYS - 1 - Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${londonDayKey(new Date(start).toISOString())}T12:00:00Z`)) / 86_400_000);
      if (idx >= 0 && idx < DAYS) perDay[idx] += Math.round((end - start) / 60_000);
    }
    const effective = Date.parse(a.effective_from);
    const watchedDays = Math.max(0, Math.floor((now - Math.max(effective, since)) / 86_400_000));
    return { reference: a.reference, visits: periods.length, minutes, perDay, inside_now: insideNow.get(a.id) ?? false, watched_days: watchedDays };
  });

  return json({ days: DAYS, first_day: firstDay, today, areas: stats }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
});
