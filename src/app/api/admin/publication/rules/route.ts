import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { auditStaff } from "@/lib/audit";
import { MIN_GRID_M } from "@/lib/publication";
import { updateLiveStatus } from "@/lib/jobs/update-live-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const zoneConfig = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_m: z.number().min(50).max(50_000),
  label: z.string().trim().max(120),
});

const ruleSchema = z.discriminatedUnion("rule_type", [
  z.object({ rule_type: z.literal("delay"), configuration: z.object({ hours: z.number().min(0).max(24 * 365) }) }),
  z.object({ rule_type: z.literal("grid"), configuration: z.object({ meters: z.number().min(MIN_GRID_M).max(50_000) }) }),
  z.object({ rule_type: z.literal("exclusion_zone"), configuration: zoneConfig }),
  z.object({ rule_type: z.literal("area_label"), configuration: zoneConfig }),
  z.object({ rule_type: z.literal("excluded_category"), configuration: z.object({ category: z.string().trim().min(1).max(50) }) }),
  z.object({ rule_type: z.literal("pause"), configuration: z.object({}).default({}) }),
  z.object({ rule_type: z.literal("home_range"), configuration: zoneConfig.omit({ label: true }).extend({ radius_m: z.number().min(500).max(50_000) }) }),
  z.object({ rule_type: z.literal("live_status"), configuration: z.object({ grid_m: z.number().min(MIN_GRID_M).max(50_000) }) }),
  z.object({
    rule_type: z.literal("publish_tracks"),
    configuration: z.object({ interval_minutes: z.number().int().min(3).max(24 * 60) }),
  }),
]);

const SINGLETONS = new Set(["delay", "grid", "pause", "publish_tracks", "home_range", "live_status"]);

const upsertSchema = z.object({
  id: z.uuid().optional(),
  enabled: z.boolean().default(true),
  rule: ruleSchema,
});

export const GET = handle(async () => {
  const { supabase } = await requireRole(["admin"]);
  const { data, error } = await supabase.from("publication_rules").select("*").order("rule_type").order("updated_at");
  if (error) throw error;
  return json({ rules: data });
});

export const POST = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const input = await parseJson(request, upsertSchema);
  const row = {
    rule_type: input.rule.rule_type,
    configuration: input.rule.configuration,
    enabled: input.enabled,
    updated_at: new Date().toISOString(),
  };
  let id = input.id;
  if (!id && SINGLETONS.has(row.rule_type)) {
    const { data: existing } = await supabase.from("publication_rules").select("id").eq("rule_type", row.rule_type).limit(1).maybeSingle();
    id = existing?.id;
  }
  const { data, error } = id
    ? await supabase.from("publication_rules").update(row).eq("id", id).select("*").single()
    : await supabase.from("publication_rules").insert(row).select("*").single();
  if (error) throw error;
  await auditStaff(supabase, user.id, {
    action: "publication_rule.saved",
    resourceType: "publication_rule",
    resourceId: data.id,
    // Exclusion-zone coordinates are deliberately not copied into the audit log.
    metadata: { rule_type: row.rule_type, enabled: row.enabled },
  });
  if (row.rule_type === "live_status" && row.enabled) {
    const { data: home } = await supabase.from("publication_rules").select("id").eq("rule_type", "home_range").eq("enabled", true).limit(1).maybeSingle();
    if (!home) {
      await supabase.from("publication_rules").update({ enabled: false }).eq("id", data.id);
      throw new HttpError(422, "Set your home range before switching on the live marker");
    }
  }
  if (["home_range", "live_status", "exclusion_zone"].includes(row.rule_type)) await updateLiveStatus();
  revalidatePath("/history");
  return json({ rule: data });
});

export const DELETE = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const id = z.uuid().parse(new URL(request.url).searchParams.get("id"));
  const { error } = await supabase.from("publication_rules").delete().eq("id", id);
  if (error) throw error;
  await auditStaff(supabase, user.id, { action: "publication_rule.deleted", resourceType: "publication_rule", resourceId: id });
  return json({ ok: true });
});
