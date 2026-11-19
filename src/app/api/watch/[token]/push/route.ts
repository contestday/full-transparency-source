import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { findWatcher } from "@/lib/watchers";
import { loadSampleWatcher } from "@/lib/sample-watcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const subSchema = z.object({
  endpoint: z.url().refine((u) => u.startsWith("https://"), "Push endpoint must be HTTPS").max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

async function activeWatcher(request: Request, ctx: Ctx) {
  await enforceRateLimits(request, [{ name: "watch-push:hour", windowSeconds: 3600, max: 20 }]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  // Anyone may turn the public sample's alerts on or off: that changes nothing on the sample.
  const sample = await loadSampleWatcher().catch(() => null);
  return { ...w, isSample: sample?.watcherId === w.id };
}

/** Register this device for entry/exit notifications about the watcher's areas. */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const w = await activeWatcher(request, ctx);
  const input = await parseJson(request, subSchema);
  const supabase = createServiceClient();
  if (!w.isSample) {
    const { count } = await supabase.from("watcher_push_subscriptions").select("id", { count: "exact", head: true }).eq("watcher_id", w.id);
    const { data: mine } = await supabase.from("watcher_push_subscriptions").select("id").eq("watcher_id", w.id).eq("endpoint", input.endpoint).maybeSingle();
    if (!mine && (count ?? 0) >= 5) throw new HttpError(422, "Up to 5 devices per watch link");
  }
  // One device can get alerts for several watch links (e.g. its own and the sample).
  const { error } = await supabase
    .from("watcher_push_subscriptions")
    .upsert({ watcher_id: w.id, endpoint: input.endpoint, keys: input.keys, enabled: true }, { onConflict: "watcher_id,endpoint" });
  if (error) throw error;
  return json({ ok: true }, { status: 201 });
});

/** Is this device signed up for this watch link's alerts? (?endpoint=…) */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const w = await activeWatcher(request, ctx);
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) return json({ subscribed: false });
  const { data } = await createServiceClient()
    .from("watcher_push_subscriptions")
    .select("id")
    .eq("watcher_id", w.id)
    .eq("endpoint", endpoint)
    .eq("enabled", true)
    .maybeSingle();
  return json({ subscribed: Boolean(data) }, { headers: { "cache-control": "private, no-store" } });
});

export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const w = await activeWatcher(request, ctx);
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) throw new HttpError(422, "endpoint required");
  await createServiceClient().from("watcher_push_subscriptions").delete().eq("watcher_id", w.id).eq("endpoint", endpoint);
  return json({ ok: true });
});
