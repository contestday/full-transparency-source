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

/** End one of this watch link's activities (any time). It stays on the record as ended. */
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const { token, reference } = await ctx.params;
  await enforceRateLimits(request, [{ name: "watch:min", windowSeconds: 60, max: 30 }]);
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  await assertNotLockedSample(w.id);
  const supabase = createServiceClient();
  const { data: a } = await supabase
    .from("banned_activities")
    .select("id, label, status")
    .eq("watcher_id", w.id)
    .eq("reference", reference.toUpperCase())
    .maybeSingle();
  if (!a) throw new HttpError(404, "Activity not found");
  if (a.status === "ended") return json({ ok: true });
  const now = new Date().toISOString();
  await supabase.from("banned_activities").update({ status: "ended", ended_at: now, updated_at: now }).eq("id", a.id);
  await auditSystem("anonymous", { action: "banned_activity.ended", resourceType: "banned_activity", resourceId: a.id });
  await notifyAdmins({ event: "watch_activity_ended", title: `Activity ended: ${a.label}`, body: `${reference.toUpperCase()} was ended by the person who set it.`, url: "/admin/events" });
  return json({ ok: true });
});
