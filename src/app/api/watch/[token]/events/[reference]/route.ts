import { handle, HttpError, json } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher } from "@/lib/watchers";
import { assertNotLockedSample } from "@/lib/sample-watcher";
import { notifyAdmins } from "@/lib/notify";
import { auditSystem } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string; reference: string }> };

/** Cancel one of this watch link's events (any time). It stays on the record as cancelled. */
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const { token, reference } = await ctx.params;
  await enforceRateLimits(request, [{ name: "watch:min", windowSeconds: 60, max: 30 }]);
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  await assertNotLockedSample(w.id);
  const supabase = createServiceClient();
  const { data: ev } = await supabase
    .from("watch_events")
    .select("id, title, status")
    .eq("watcher_id", w.id)
    .eq("reference", reference.toUpperCase())
    .maybeSingle();
  if (!ev) throw new HttpError(404, "Event not found");
  if (ev.status === "cancelled") return json({ ok: true });
  const now = new Date().toISOString();
  await supabase.from("watch_events").update({ status: "cancelled", cancelled_at: now, updated_at: now }).eq("id", ev.id);
  await auditSystem("anonymous", { action: "watch_event.cancelled", resourceType: "watch_event", resourceId: ev.id });
  await notifyAdmins({ event: "watch_event_cancelled", title: `Event cancelled: ${ev.title}`, body: `${reference.toUpperCase()} was cancelled by the person who set it.`, url: "/admin/events" });
  return json({ ok: true });
});
