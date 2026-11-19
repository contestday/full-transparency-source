import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { planInputSchema, planPatchSchema, type PlanRow } from "@/lib/plans";
import { buildPlanRow, syncPlanLocations } from "@/lib/plans-server";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** When a plan really happened (sent with "Yes, it happened"). */
const actualSchema = z
  .object({ actual_started_at: z.iso.datetime({ offset: true }).nullable().optional(), actual_ended_at: z.iso.datetime({ offset: true }).nullable().optional() })
  .refine((a) => !a.actual_started_at || !a.actual_ended_at || Date.parse(a.actual_ended_at) >= Date.parse(a.actual_started_at), {
    message: "The end time must be after the start time",
  });

async function loadPlan(supabase: Awaited<ReturnType<typeof requireRole>>["supabase"], id: string) {
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Plan not found");
  const { data, error } = await supabase.from("planned_activities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Plan not found");
  return data as PlanRow;
}

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { supabase, user } = await requireRole(["admin"]);
  const existing = await loadPlan(supabase, id);
  const raw = await parseJson(request, z.looseObject({}));
  const patch = planPatchSchema.parse(raw);
  const actual = actualSchema.parse(raw);
  // Merge then validate the whole plan so cross-field rules (e.g. sensitive
  // categories) are enforced on every update.
  const merged = planInputSchema.parse({
    title: existing.title,
    category: existing.category,
    venue_id: existing.venue_id,
    description: existing.description,
    starts_at: existing.starts_at,
    ends_at: existing.ends_at,
    all_day: existing.all_day,
    lat: existing.lat,
    lng: existing.lng,
    status: existing.status,
    publication_mode: existing.publication_mode,
    public_area_label: existing.public_area_label,
    confirm_sensitive_exact: existing.publication_mode === "exact_venue" && patch.publication_mode === undefined && patch.category === undefined,
    // Keep an earlier explicit confirmation unless mode/venue/location change.
    confirm_private_exact:
      (existing.publication_mode === "exact_venue" || existing.publication_mode === "retrospective") &&
      patch.publication_mode === undefined && patch.venue_id === undefined && patch.lat === undefined,
    ...patch,
  });
  const row = await buildPlanRow(supabase, merged, existing);
  const { data, error } = await supabase.from("planned_activities").update(row).eq("id", id).select("*").single();
  if (error) throw error;
  await syncPlanLocations(supabase, id, data.publication_mode, patch.extra_venue_ids);
  // Record who settled the outcome: me (unless GPS already had), or clear it if reopened.
  if (patch.status && patch.status !== existing.status) {
    const source = (existing as { completion_source?: string | null }).completion_source ?? null;
    const next = patch.status === "completed" ? (source === "gps" ? "gps" : "owner") : null;
    const { error: srcErr } = await supabase.from("planned_activities").update({ completion_source: next }).eq("id", id);
    if (!srcErr) (data as Record<string, unknown>).completion_source = next;
    else if (!/completion_source/.test(srcErr.message)) throw srcErr;
  }
  if (actual.actual_started_at !== undefined || actual.actual_ended_at !== undefined) {
    const times = { actual_started_at: actual.actual_started_at ?? null, actual_ended_at: actual.actual_ended_at ?? null };
    const { error: tErr } = await supabase.from("planned_activities").update(times).eq("id", id);
    if (!tErr) Object.assign(data as Record<string, unknown>, times);
    else if (!/actual_/.test(tErr.message)) throw tErr;
  }
  await auditStaff(supabase, user.id, {
    action: "plan.updated",
    resourceType: "planned_activity",
    resourceId: id,
    metadata: { changed: Object.keys(patch), status: data.status, publication_mode: data.publication_mode },
  });
  revalidatePath("/plans", "layout");
  return json({ plan: data });
});

/**
 * Archive (soft delete; default) or, with ?permanent=1, delete the plan and its
 * locations for good. Archived plans disappear from the public board.
 */
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { supabase, user } = await requireRole(["admin"]);
  const plan = await loadPlan(supabase, id);
  if (new URL(request.url).searchParams.get("permanent") === "1") {
    const { error } = await supabase.from("planned_activities").delete().eq("id", id);
    if (error) throw error;
    await auditStaff(supabase, user.id, { action: "plan.deleted", resourceType: "planned_activity", resourceId: id, metadata: { title: plan.title } });
    revalidatePath("/plans", "layout");
    return json({ ok: true, deleted: true });
  }
  const { error } = await supabase
    .from("planned_activities")
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  await auditStaff(supabase, user.id, { action: "plan.archived", resourceType: "planned_activity", resourceId: id });
  revalidatePath("/plans", "layout");
  return json({ ok: true });
});
