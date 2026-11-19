import { handle, HttpError, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher } from "@/lib/watchers";
import { loadWatchAreas, zoneAreas } from "@/lib/watch-areas";
import { loadOkayZone } from "@/lib/home";
import { getPublicHistory } from "@/lib/public-data";
import { colouredRouteSegments } from "@/lib/route";
import { zoneAt } from "@/lib/geofence/tiers";
import { londonDayKey } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * One day's published journey, coloured for this watcher: purple / red / amber
 * in their own areas, otherwise green inside my okay zone and yellow outside.
 * Only the colours are worked out here; the positions are the public history.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-journey:min", windowSeconds: 60, max: 20 }]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  const raw = new URL(request.url).searchParams.get("day");
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : londonDayKey(new Date().toISOString());
  // A London day can start an hour before UTC midnight: fetch wide, then keep the day.
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - 3_600_000).toISOString();
  const to = new Date(Date.parse(`${day}T23:59:59.999Z`) + 3_600_000).toISOString();
  const [areas, okay, history] = await Promise.all([loadWatchAreas(w.id, token.toUpperCase()), loadOkayZone(), getPublicHistory(from, to)]);
  const records = history.records.filter((r) => londonDayKey(r.observed_at) === day);
  const zAreas = zoneAreas(areas);
  const zoneOf = (p: { lat: number; lng: number }, at?: number) => zoneAt(p, okay, zAreas, [], at);
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
  return json({ day, segments, stops }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
});
