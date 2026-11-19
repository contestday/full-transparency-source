import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { RECURRENCE, recurrenceStarts, type PlanRow } from "@/lib/plans";
import { syncPlanLocations } from "@/lib/plans-server";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ every: z.enum(RECURRENCE), count: z.number().int().min(1).max(52) });

/** Create repeats of a plan (same details and locations) as a series. */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Plan not found");
  const { supabase, user } = await requireRole(["admin"]);
  const { every, count } = await parseJson(request, schema);
  const { data: plan, error } = await supabase.from("planned_activities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!plan) throw new HttpError(404, "Plan not found");
  const p = plan as PlanRow & { series_id: string | null };
  const seriesId = p.series_id ?? crypto.randomUUID();
  if (!p.series_id) await supabase.from("planned_activities").update({ series_id: seriesId }).eq("id", id);
  const { data: stops } = await supabase.from("plan_locations").select("venue_id").eq("plan_id", id).order("position");
  const duration = p.ends_at ? Date.parse(p.ends_at) - Date.parse(p.starts_at) : null;

  const rows = recurrenceStarts(p.starts_at, every, count).map((start) => ({
    title: p.title,
    category: p.category,
    venue_id: p.venue_id,
    description: p.description,
    starts_at: start,
    ends_at: duration != null ? new Date(Date.parse(start) + duration).toISOString() : null,
    all_day: p.all_day,
    lat: p.lat,
    lng: p.lng,
    status: p.status === "completed" || p.status === "cancelled" ? "planned" : p.status,
    publication_mode: p.publication_mode,
    public_area_label: p.public_area_label,
    public_lat: p.public_lat,
    public_lng: p.public_lng,
    public_cell_size_m: p.public_cell_size_m,
    published_at: p.published_at ? new Date().toISOString() : null,
    series_id: seriesId,
  }));
  const { data: created, error: insErr } = await supabase.from("planned_activities").insert(rows).select("id, publication_mode");
  if (insErr) throw insErr;
  const venueIds = (stops ?? []).map((s) => s.venue_id as string);
  if (venueIds.length) for (const c of created ?? []) await syncPlanLocations(supabase, c.id, c.publication_mode, venueIds);
  await auditStaff(supabase, user.id, { action: "plan.recurred", resourceType: "planned_activity", resourceId: id, metadata: { every, count } });
  revalidatePath("/plans", "layout");
  return json({ created: created?.length ?? 0, series_id: seriesId }, { status: 201 });
});
