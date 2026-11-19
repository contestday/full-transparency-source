import { handle, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { findWatcher } from "@/lib/watchers";
import { loadSampleWatcher } from "@/lib/sample-watcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** A short summary of a watch link, for the "My watch links" list on this device. */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-info:min", windowSeconds: 60, max: 40 }]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
  if (!w || w.status !== "active") return json({ valid: false }, { headers });
  const supabase = createServiceClient();
  const [{ data: me }, { count }, sample] = await Promise.all([
    supabase.from("watchers").select("display_code").eq("id", w.id).maybeSingle(),
    supabase.from("geofences").select("id", { count: "exact", head: true }).eq("watcher_id", w.id).eq("status", "active"),
    loadSampleWatcher().catch(() => null),
  ]);
  return json({ valid: true, display_code: (me?.display_code as string | null) ?? null, areas: count ?? 0, is_sample: sample?.watcherId === w.id }, { headers });
});
