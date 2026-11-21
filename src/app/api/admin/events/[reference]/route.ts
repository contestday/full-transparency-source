import { requireRole } from "@/lib/auth";
import { handle, HttpError, json } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancel one of my own bans. It stays on the record as cancelled. */
export const DELETE = handle(async (_request: Request, ctx: { params: Promise<{ reference: string }> }) => {
  const { user, supabase } = await requireRole(["admin"]);
  const { reference } = await ctx.params;
  const service = createServiceClient();
  const { data: ev } = await service.from("watch_events").select("id, status").eq("reference", reference.toUpperCase()).eq("is_owner", true).maybeSingle();
  if (!ev) throw new HttpError(404, "Event not found");
  if (ev.status !== "cancelled") {
    const now = new Date().toISOString();
    await service.from("watch_events").update({ status: "cancelled", cancelled_at: now, updated_at: now }).eq("id", ev.id);
    await auditStaff(supabase, user.id, { action: "watch_event.owner_cancelled", resourceType: "watch_event", resourceId: ev.id });
  }
  return json({ ok: true });
});
