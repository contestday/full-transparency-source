import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { handle, json, parseJson } from "@/lib/http";
import { planInputSchema } from "@/lib/plans";
import { buildPlanRow, syncPlanLocations } from "@/lib/plans-server";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const { supabase } = await requireRole(["admin"]);
  const url = new URL(request.url);
  const includeArchived = url.searchParams.get("archived") === "true";
  let q = supabase
    .from("planned_activities")
    .select("*, venue:venues(id, name, category), plan_locations(venue_id, position)")
    .order("starts_at", { ascending: true })
    .limit(500);
  if (!includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw error;
  return json({ plans: data });
});

export const POST = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const input = await parseJson(request, planInputSchema);
  const row = await buildPlanRow(supabase, input);
  const { data, error } = await supabase.from("planned_activities").insert(row).select("*").single();
  if (error) throw error;
  await syncPlanLocations(supabase, data.id, data.publication_mode, input.extra_venue_ids ?? []);
  await auditStaff(supabase, user.id, {
    action: "plan.created",
    resourceType: "planned_activity",
    resourceId: data.id,
    metadata: { status: data.status, publication_mode: data.publication_mode },
  });
  revalidatePath("/plans", "layout");
  return json({ plan: data }, { status: 201 });
});
