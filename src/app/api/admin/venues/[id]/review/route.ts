import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { auditStaff } from "@/lib/audit";
import { buildPolicy, decide, type PublicationRuleRow } from "@/lib/publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  decision: z.enum(["public", "private", "reject"]),
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(50).optional(),
});

/**
 * Review a suggested venue.
 *   public  → shown in full; already-published stays there are upgraded to the venue
 *   private → kept for your own records, shown by area only
 *   reject  → venue deleted and its stays unlinked
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const { supabase, user } = await requireRole(["admin"]);
  const input = await parseJson(request, schema);
  const { data: venue, error } = await supabase.from("venues").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!venue) throw new HttpError(404, "Not found");

  if (input.decision === "reject") {
    await supabase.from("visits").update({ venue_id: null, category: null }).eq("venue_id", id);
    const { error: delErr } = await supabase.from("venues").delete().eq("id", id);
    if (delErr) throw delErr;
    await auditStaff(supabase, user.id, { action: "venue.suggestion_rejected", resourceType: "venue", resourceId: id, metadata: { name: venue.name } });
    return json({ ok: true, deleted: true });
  }

  const isPublic = input.decision === "public";
  const category = input.category ?? venue.category;
  const { data: updated, error: updErr } = await supabase
    .from("venues")
    .update({
      is_public: isPublic,
      name: input.name ?? venue.name,
      category,
      metadata: { ...(venue.metadata ?? {}), status: "confirmed", confirmed_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) throw updErr;
  if (input.category) await supabase.from("visits").update({ category }).eq("venue_id", id);

  // Bring already-published stays at this venue in line with the decision.
  const [{ data: rules }, { data: visits }] = await Promise.all([
    supabase.from("publication_rules").select("rule_type, configuration, enabled"),
    supabase.from("visits").select("id, started_at, ended_at, lat, lng, radius_m, category").eq("venue_id", id),
  ]);
  const policy = { ...buildPolicy((rules ?? []) as PublicationRuleRow[]), paused: false, delayHours: 0 };
  let changed = 0;
  for (const v of visits ?? []) {
    const d = decide(
      {
        key: `visit:${v.id}`,
        kind: "visit",
        visitId: v.id,
        lat: v.lat,
        lng: v.lng,
        radiusM: v.radius_m ?? 0,
        category: v.category,
        observedAt: v.started_at,
        observedUntil: v.ended_at,
        areaLabelHint: updated.public_area_label,
        publicVenue: isPublic && updated.lat != null ? { lat: updated.lat, lng: updated.lng, name: updated.name } : null,
      },
      policy,
    );
    const patch = d.publish
      ? {
          public_lat: d.record.public_lat,
          public_lng: d.record.public_lng,
          cell_size_m: d.record.cell_size_m,
          venue_name: d.record.venue_name,
          area_label: d.record.area_label,
          category: d.record.category,
        }
      : { visibility_status: "withdrawn", withdrawn_at: new Date().toISOString(), withdrawn_reason: `venue review: ${d.reason}` };
    const { data: rows } = await supabase
      .from("published_locations")
      .update(patch)
      .eq("source_key", `visit:${v.id}`)
      .eq("visibility_status", "published")
      .select("id");
    changed += rows?.length ?? 0;
  }

  await auditStaff(supabase, user.id, {
    action: `venue.suggestion_${input.decision}`,
    resourceType: "venue",
    resourceId: id,
    metadata: { name: updated.name, published_updated: changed },
  });
  revalidatePath("/history");
  return json({ venue: updated, published_updated: changed });
});
