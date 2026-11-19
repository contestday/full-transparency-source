import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { findWatcher, recentWatcherAlerts } from "@/lib/watchers";
import { assertNotLockedSample } from "@/lib/sample-watcher";
import { escrowAreaKey } from "@/lib/watch-seal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** Recent alerts for this watch link, for the popup on its page (last 24 hours). */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-alerts-log:min", windowSeconds: 60, max: 30 }]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  return json({ alerts: await recentWatcherAlerts(w.id) }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
});

/**
 * Turn alerts for my local areas and locations on or off. On: the server keeps
 * this link's area key (encrypted with a server secret) so it can check them
 * when new GPS arrives. Off: the key is deleted and they are sealed again.
 */
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-alerts:hour", windowSeconds: 3600, max: 20 }]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  await assertNotLockedSample(w.id);
  const { enabled } = await parseJson(request, z.object({ enabled: z.boolean() }));
  const supabase = createServiceClient();
  await supabase.from("watchers").update({ alert_key: enabled ? escrowAreaKey(token.toUpperCase()) : null }).eq("id", w.id);
  if (!enabled) {
    // Forget the inside/outside state of the sealed areas too.
    const { data: sealed } = await supabase.from("geofences").select("id").eq("watcher_id", w.id).not("sealed", "is", null);
    const ids = (sealed ?? []).map((r) => r.id as string);
    if (ids.length) await supabase.from("geofence_state").delete().in("geofence_id", ids);
  }
  return json({ ok: true, sealed_alerts: enabled });
});
