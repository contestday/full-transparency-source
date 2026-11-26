import { requireRole } from "@/lib/auth";
import { handle, HttpError, json } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ reference: string }> };

/** End one of my own banned activities. It stays on the record as ended. */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { user, supabase } = await requireRole(["admin"]);
  const { reference } = await ctx.params;
  const service = createServiceClient();
  const { data: a } = await service.from("banned_activities").select("id, status").eq("is_owner", true).eq("reference", reference.toUpperCase()).maybeSingle();
  if (!a) throw new HttpError(404, "Activity not found");
  if (a.status === "ended") return json({ ok: true });
  const now = new Date().toISOString();
  await service.from("banned_activities").update({ status: "ended", ended_at: now, updated_at: now }).eq("id", a.id);
  await auditStaff(supabase, user.id, { action: "banned_activity.owner_ended", resourceType: "banned_activity", resourceId: a.id });
  return json({ ok: true });
});
