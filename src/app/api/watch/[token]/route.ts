import { handle, HttpError, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher, watcherView } from "@/lib/watchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** A watcher's private view: their own areas and the colour relative to them. */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  await enforceRateLimits(request, [{ name: "watch:min", windowSeconds: 60, max: 30 }]);
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  return json(await watcherView(w.id, token.toUpperCase()), { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
});
