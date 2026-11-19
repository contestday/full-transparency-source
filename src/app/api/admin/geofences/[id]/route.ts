import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { auditStaff } from "@/lib/audit";
import { notifyAdmins } from "@/lib/notify";
import { updateLiveStatus } from "@/lib/jobs/update-live-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    verification_status: z.enum(["unverified", "verified", "disputed"]),
    // Public display is not implemented; only private/rejected are settable.
    moderation_status: z.enum(["private", "rejected"]),
    status: z.enum(["active", "withdrawn", "archived"]),
    description: z.string().trim().max(1000).nullable(),
    category: z.string().max(50).nullable(),
  })
  .partial();

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const { supabase, user } = await requireRole(["admin"]);
  const patch = await parseJson(request, patchSchema);
  const { data, error } = await supabase
    .from("geofences")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, reference, status")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Not found");
  const eventType = patch.status && patch.status !== "active" ? "withdrawn" : "changed";
  await supabase.from("geofence_events").insert({ geofence_id: id, event_type: eventType, observed_at: new Date().toISOString() });
  await auditStaff(supabase, user.id, { action: `geofence.${eventType}`, resourceType: "geofence", resourceId: id, metadata: patch });
  await notifyAdmins({
    event: "geofence_changed",
    title: `Area ${eventType}`,
    body: `${data.reference} was ${eventType} by an administrator.`,
    url: "/admin/geofences",
  });
  if (patch.status) {
    // An archived/withdrawn fence no longer counts towards the live marker.
    if (patch.status !== "active") await supabase.from("geofence_state").update({ inside: false, pending_inside: null, pending_count: 0 }).eq("geofence_id", id);
    await updateLiveStatus();
  }
  return json({ geofence: data });
});
