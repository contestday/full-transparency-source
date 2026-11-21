import { handle, HttpError, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher, loadOwnerProfile } from "@/lib/watchers";
import { loadWatcherEvents } from "@/lib/events/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** A watch link's own events (only with the link). */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  await enforceRateLimits(request, [{ name: "watch:min", windowSeconds: 60, max: 30 }]);
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  const [events, owner] = await Promise.all([loadWatcherEvents(w.id), loadOwnerProfile()]);
  return json(
    { owner_first: owner.first, events: events.map((e) => ({ ...e, watcher_id: undefined })) },
    { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } },
  );
});
