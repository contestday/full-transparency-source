import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json } from "@/lib/http";
import { auditStaff } from "@/lib/audit";
import { updateLiveStatus } from "@/lib/jobs/update-live-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Revoke a watch link: the link stops working and all its areas are archived. */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const { supabase, user } = await requireRole(["admin"]);
  const { data, error } = await supabase.from("watchers").update({ status: "revoked" }).eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Not found");
  const { data: fences } = await supabase
    .from("geofences")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("watcher_id", id)
    .eq("status", "active")
    .select("id");
  const ids = (fences ?? []).map((f) => f.id);
  if (ids.length) await supabase.from("geofence_state").update({ inside: false, pending_inside: null, pending_count: 0 }).in("geofence_id", ids);
  await supabase.from("watcher_push_subscriptions").update({ enabled: false }).eq("watcher_id", id);
  await auditStaff(supabase, user.id, { action: "watcher.revoked", resourceType: "watcher", resourceId: id, metadata: { archived_areas: ids.length } });
  await updateLiveStatus();
  return json({ ok: true, archived: ids.length });
});
