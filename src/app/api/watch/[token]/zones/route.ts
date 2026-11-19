import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher } from "@/lib/watchers";
import { loadWatchAreas, zoneAreas } from "@/lib/watch-areas";
import { watchZoneAt } from "@/lib/geofence/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const body = z.object({
  points: z
    .array(z.object({ id: z.string().max(80), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), at: z.number().int().optional() }))
    .max(1000),
});

/**
 * Which of these public points (plans, stops) lie in this watcher's own
 * areas, for colouring cards. Answers only about the watcher's own areas.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-zones:min", windowSeconds: 60, max: 30 }]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  const { points } = await parseJson(request, body);
  const areas = zoneAreas(await loadWatchAreas(w.id, token.toUpperCase()));
  const zones: Record<string, string | null> = {};
  // An area set after the plan's time doesn't colour it.
  for (const p of points) zones[p.id] = areas.length ? watchZoneAt(p, areas, p.at) : null;
  return json({ zones }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
});
