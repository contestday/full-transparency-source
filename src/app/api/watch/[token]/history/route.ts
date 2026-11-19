import { handle, HttpError, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher } from "@/lib/watchers";
import { loadWatchAreas, zoneAreas } from "@/lib/watch-areas";
import { getPublicHistory } from "@/lib/public-data";
import { colourHistory, loadPublicZoneContext } from "@/lib/zones";
import { historyRange, routesShown } from "@/lib/history-range";
import { loadHomeArea } from "@/lib/home";
import { lookupPlace } from "@/lib/place-lookup";
import { pointInArea } from "@/lib/geofence/area-geometry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Watched history: the published history for a date range, coloured for this
 * watcher. Positions are the public history; only the colours are theirs.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-history:min", windowSeconds: 60, max: 20 }]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  const sp = new URL(request.url).searchParams;
  const { from, to } = historyRange({ from: sp.get("from"), to: sp.get("to") });
  const [areas, zctx, history, homeArea] = await Promise.all([
    loadWatchAreas(w.id, token.toUpperCase()),
    loadPublicZoneContext(),
    getPublicHistory(`${from}T00:00:00Z`, `${to}T23:59:59.999Z`, { stopsOnly: !routesShown(from, to) }),
    loadHomeArea().catch(() => null),
  ]);
  // Place search: only what happened inside the searched place.
  const placeQ = (sp.get("place") ?? "").trim().slice(0, 100);
  const place = placeQ.length >= 2 ? await lookupPlace(placeQ) : null;
  const records = place ? history.records.filter((r) => pointInArea({ lat: r.public_lat, lng: r.public_lng }, place.geometry)) : history.records;
  const colours = colourHistory(records, zctx, zoneAreas(areas));
  return json(
    { from, to, records, ...colours, areaCount: areas.length, home_area: homeArea, place: placeQ ? (place ?? false) : null },
    { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } },
  );
});
