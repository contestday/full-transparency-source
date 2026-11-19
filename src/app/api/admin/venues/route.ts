import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, json, parseJson } from "@/lib/http";
import { auditStaff } from "@/lib/audit";
import { buildPlanRow, syncPlanLocations } from "@/lib/plans-server";
import { planInputSchema, type PlanRow } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const venueSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(50),
    address: z.string().trim().max(500).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    public_area_label: z.string().trim().max(120).nullable().optional(),
    is_public: z.boolean().default(false),
  })
  .refine((v) => (v.lat == null) === (v.lng == null), { message: "Latitude and longitude must be provided together" });

export const GET = handle(async (request: Request) => {
  const { supabase } = await requireRole(["admin"]);
  const q = new URL(request.url).searchParams.get("q")?.trim();
  let query = supabase.from("venues").select("*").order("name").limit(200);
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw error;
  return json({ venues: data });
});

export const POST = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const input = await parseJson(request, venueSchema);
  const row = {
    name: input.name,
    category: input.category,
    address: input.address ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    public_area_label: input.public_area_label ?? null,
    is_public: input.is_public,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = input.id
    ? await supabase.from("venues").update(row).eq("id", input.id).select("*").single()
    : await supabase.from("venues").insert(row).select("*").single();
  if (error) throw error;

  if (input.id) {
    // Recompute public location of plans that use this venue.
    const { data: plans } = await supabase.from("planned_activities").select("*").eq("venue_id", input.id);
    for (const p of (plans ?? []) as PlanRow[]) {
      const parsed = planInputSchema.safeParse({ ...p, confirm_sensitive_exact: true });
      if (!parsed.success) continue;
      let data = parsed.data;
      // A venue switched to private must not stay published at venue precision.
      if (!input.is_public && (data.publication_mode === "exact_venue" || data.publication_mode === "retrospective")) {
        data = { ...data, publication_mode: "general_area" };
      }
      const planRow = await buildPlanRow(supabase, data, p);
      await supabase.from("planned_activities").update(planRow).eq("id", p.id);
    }
    // …and of plans that use it as an additional location.
    const { data: stops } = await supabase.from("plan_locations").select("plan_id, planned_activities(publication_mode)").eq("venue_id", input.id);
    for (const s of stops ?? []) {
      const mode = (s.planned_activities as unknown as { publication_mode: PlanRow["publication_mode"] } | null)?.publication_mode;
      if (mode) await syncPlanLocations(supabase, s.plan_id as string, mode);
    }
    revalidatePath("/plans", "layout");
  }

  await auditStaff(supabase, user.id, {
    action: input.id ? "venue.updated" : "venue.created",
    resourceType: "venue",
    resourceId: data.id,
  });
  return json({ venue: data }, { status: input.id ? 200 : 201 });
});
