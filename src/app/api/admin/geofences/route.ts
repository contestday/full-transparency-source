import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { geofenceSubmissionSchema, GeofenceValidationError, normaliseGeofence } from "@/lib/geofence/submission";
import { loadHome } from "@/lib/home";
import { DEFAULT_SUBMISSION_BOUNDS } from "@/lib/geo";
import { makeReference } from "@/lib/crypto";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const { supabase, role } = await requireRole(["admin", "reviewer"]);
  const status = new URL(request.url).searchParams.get("status") ?? "active";
  let q = supabase.from("geofences_geojson").select("*").order("submitted_at", { ascending: false }).limit(500);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  let events: unknown[] = [];
  if (role === "admin") {
    const { data: ev } = await supabase
      .from("geofence_events")
      // Watchers' Locations are private to them: Wish and Want areas and mine only.
      .select("id, geofence_id, event_type, observed_at, accuracy_m, geofences!inner(tier)")
      .or("tier.is.null,tier.in.(wide,local)", { referencedTable: "geofences" })
      .order("observed_at", { ascending: false })
      .limit(200);
    events = ev ?? [];
  }
  return json({ geofences: data, events });
});

/** Admin-created geofence (e.g. their own area to monitor). */
const adminCreateSchema = z.object({
  shape: geofenceSubmissionSchema.shape.shape,
  description: z.string().trim().max(1000).optional(),
  category: z.string().max(50).optional(),
});

export const POST = handle(async (request: Request) => {
  const { user, supabase } = await requireRole(["admin"]);
  const input = await parseJson(request, adminCreateSchema);
  let shape;
  try {
    // Admins are not limited to the public submission bounds.
    shape = normaliseGeofence(
      input.shape,
      { ...DEFAULT_SUBMISSION_BOUNDS, minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 },
      input.shape.type === "beyond_home" ? await loadHome() : null,
    );
  } catch (err) {
    if (err instanceof GeofenceValidationError) throw new HttpError(422, err.message);
    throw err;
  }
  const reference = makeReference("G");
  // insert_geofence is service-role only; authorisation was checked above.
  const { data: id, error } = await createServiceClient().rpc("insert_geofence", {
    p_reference: reference,
    p_geojson: shape.geojson,
    p_shape_type: shape.shapeType,
    p_center_lat: shape.center.lat,
    p_center_lng: shape.center.lng,
    p_radius_m: shape.radiusM,
    p_description: input.description ?? null,
    p_category: input.category ?? null,
    p_origin: "admin",
    p_withdrawal_code_hash: null,
    p_submitter_hash: null,
  });
  if (error) throw error;
  await auditStaff(supabase, user.id, { action: "geofence.created", resourceType: "geofence", resourceId: id });
  return json({ id, reference }, { status: 201 });
});
