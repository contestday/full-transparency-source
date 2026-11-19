import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const { supabase } = await requireRole(["admin"]);
  const { data, error } = await supabase.from("profiles").select("id, email, role, created_at").order("created_at");
  if (error) throw error;
  return json({ users: data });
});

const schema = z.object({ id: z.uuid(), role: z.enum(["none", "reviewer", "admin"]) });

/** Grant or revoke access. Setting role 'none' revokes immediately (RLS checks role on every query). */
export const POST = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const input = await parseJson(request, schema);
  if (input.id === user.id && input.role !== "admin") {
    throw new HttpError(422, "You cannot remove your own administrator role");
  }
  const { data, error } = await supabase.from("profiles").update({ role: input.role }).eq("id", input.id).select("id, role").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "User not found");
  await auditStaff(supabase, user.id, { action: "user.role_changed", resourceType: "profile", resourceId: input.id, metadata: { role: input.role } });
  return json({ user: data });
});
