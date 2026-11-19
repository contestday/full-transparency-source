import { handle, HttpError, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher } from "@/lib/watchers";
import { loadWatchAreas, zoneAreas } from "@/lib/watch-areas";
import { getPublicHistory } from "@/lib/public-data";
import { colourHistory, loadPublicZoneContext } from "@/lib/zones";
import { historyRange } from "@/lib/history-range";

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
  const [areas, zctx, history] = await Promise.all([
    loadWatchAreas(w.id, token.toUpperCase()),
    loadPublicZoneContext(),
    getPublicHistory(`${from}T00:00:00Z`, `${to}T23:59:59.999Z`),
  ]);
  const colours = colourHistory(history.records, zctx, zoneAreas(areas));
  return json(
    { from, to, records: history.records, ...colours, areaCount: areas.length },
    { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } },
  );
});
