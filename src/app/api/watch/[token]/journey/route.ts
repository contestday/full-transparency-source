import { handle, HttpError, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher } from "@/lib/watchers";
import { loadWatchAreas, zoneAreas } from "@/lib/watch-areas";
import { loadOkayZone } from "@/lib/home";
import { getPublicHistory } from "@/lib/public-data";
import { colouredRouteSegments } from "@/lib/route";
import { zoneAt } from "@/lib/geofence/tiers";
import { loadWatcherEvents } from "@/lib/events/server";
import { eventOnAt } from "@/lib/events/rules";
import { pointInArea } from "@/lib/geofence/area-geometry";
import { londonDayKey } from "@/lib/format";
import { isDate, routesShown } from "@/lib/history-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * The published journey for one day (?day=) or a range of days (?from=&to=), coloured for this watcher: purple / red / amber
 * in their own areas, otherwise green inside my okay zone and yellow outside.
 * Only the colours are worked out here; the positions are the public history.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-journey:min", windowSeconds: 60, max: 20 }]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  const sp = new URL(request.url).searchParams;
  const pick = (k: string) => {
    const v = sp.get(k);
    return isDate(v) ? v : null;
  };
  const day = pick("day") ?? londonDayKey(new Date().toISOString());
  // A range (?from=&to=), or one day (?day=).
  const fromDay = pick("from") ?? day;
  const toDay = pick("to") ?? day;
  // A London day can start an hour before UTC midnight: fetch wide, then keep the days.
  const from = new Date(Date.parse(`${fromDay}T00:00:00Z`) - 3_600_000).toISOString();
  const to = new Date(Date.parse(`${toDay}T23:59:59.999Z`) + 3_600_000).toISOString();
  const routes = routesShown(fromDay, toDay);
  const [areas, okay, history] = await Promise.all([
    loadWatchAreas(w.id, token.toUpperCase()),
    loadOkayZone(),
    getPublicHistory(from, to, { stopsOnly: !routes }),
  ]);
  const records = history.records.filter((r) => {
    const k = londonDayKey(r.observed_at);
    return k >= fromDay && k <= toDay;
  });
  const zAreas = zoneAreas(areas);
  // Their events: black where and while one was on.
  const events = (await loadWatcherEvents(w.id).catch(() => [])).filter((e) => e.status === "active");
  const atEvent = (p: { lat: number; lng: number }, at: number) =>
    events.some((e) => eventOnAt(e, at) && e.places.some((pl) => pointInArea(p, pl.geojson)));
  const zoneOf = (p: { lat: number; lng: number }, at?: number) => (at != null && atEvent(p, at) ? "black" : zoneAt(p, okay, zAreas, [], at));
  const segments = colouredRouteSegments(records, zoneOf);
  const stops = records
    .filter((r) => r.kind === "visit")
    .map((r) => ({
      lat: r.public_lat,
      lng: r.public_lng,
      name: r.venue_name ?? r.area_label ?? "Stop",
      from: r.observed_at,
      until: r.observed_until,
      zone: zoneOf({ lat: r.public_lat, lng: r.public_lng }, Date.parse(r.observed_at)),
    }));
  return json({ day, from: fromDay, to: toDay, routes, segments, stops }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
});
