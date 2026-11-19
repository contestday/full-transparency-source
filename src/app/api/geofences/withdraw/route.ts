import { z } from "zod";
import { handle, HttpError, json, parseJson, safeEqual } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimits } from "@/lib/rate-limit";
import { sha256Hex } from "@/lib/crypto";
import { notifyAdmins } from "@/lib/notify";
import { auditSystem } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  reference: z.string().trim().toUpperCase().regex(/^FT-G-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  withdrawal_code: z.string().trim().toUpperCase().min(10).max(10),
});

/** Lets an anonymous submitter withdraw their own submission. */
export const POST = handle(async (request: Request) => {
  await enforceRateLimits(request, [{ name: "geofence-withdraw:hour", windowSeconds: 3600, max: 10 }]);
  const input = await parseJson(request, schema);
  const supabase = createServiceClient();
  const { data: fence } = await supabase
    .from("geofences")
    .select("id, withdrawal_code_hash, status")
    .eq("reference", input.reference)
    .maybeSingle();
  const hash = await sha256Hex(input.withdrawal_code);
  if (!fence || !fence.withdrawal_code_hash || !safeEqual(hash, fence.withdrawal_code_hash)) {
    throw new HttpError(404, "Reference or code not recognised");
  }
  if (fence.status !== "active") return json({ ok: true, status: fence.status });
  await supabase.from("geofences").update({ status: "withdrawn", updated_at: new Date().toISOString() }).eq("id", fence.id);
  await supabase.from("geofence_events").insert({
    geofence_id: fence.id,
    event_type: "withdrawn",
    observed_at: new Date().toISOString(),
  });
  await auditSystem("anonymous", { action: "geofence.withdrawn_by_submitter", resourceType: "geofence", resourceId: fence.id });
  await notifyAdmins({
    event: "geofence_changed",
    title: "Area of concern withdrawn",
    body: `Submitter withdrew ${input.reference}.`,
    url: "/admin/geofences",
  });
  return json({ ok: true, status: "withdrawn" });
});
