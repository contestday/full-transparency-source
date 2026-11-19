import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { assertSenderAllowed, requestCountry } from "@/lib/submission-guard";
import { createServiceClient } from "@/lib/supabase/server";
import { findWatcher } from "@/lib/watchers";
import { assertNotLockedSample } from "@/lib/sample-watcher";
import { updateLiveStatus } from "@/lib/jobs/update-live-status";
import { auditSystem } from "@/lib/audit";
import { geofenceSubmissionSchema, GeofenceValidationError } from "@/lib/geofence/submission";
import { applyWantGrowth, buildWantGrowth, buildWatchArea, grewMessage, loadWatchAreas, tierContext } from "@/lib/watch-areas";
import { sameArea } from "@/lib/geofence/tiers";
import { areaKeyFor, seal, unseal, type SealedArea } from "@/lib/watch-seal";
import { makeReference } from "@/lib/crypto";
import { parseBounds } from "@/lib/geo";
import { optionalEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string; reference: string }> };

/** A Location's sealed contents with a new name/note (same blurred shape and point). */
async function resealWithName(token: string, id: string, name: string, note: string): Promise<string | null> {
  const { data } = await createServiceClient().from("geofences").select("sealed").eq("id", id).maybeSingle();
  if (!data?.sealed) return null;
  const key = areaKeyFor(token);
  const s = unseal<SealedArea>(key, data.sealed as string);
  return seal(key, { ...s, name, note });
}

async function ownFence(ctx: Ctx) {
  const { token, reference } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  await assertNotLockedSample(w.id);
  const { data: fence } = await createServiceClient()
    .from("geofences")
    .select("id, reference, status")
    .eq("reference", reference.toUpperCase())
    .eq("watcher_id", w.id)
    .maybeSingle();
  if (!fence) throw new HttpError(404, "Area not found on this watch link");
  return { watcher: w, token: token.toUpperCase(), fence: fence as { id: string; reference: string; status: string } };
}

/** Forget whether I'm inside (the area changed or went). */
async function resetState(fenceId: string) {
  await createServiceClient().from("geofence_state").delete().eq("geofence_id", fenceId);
}

const editSchema = z.object({
  tier: z.enum(["wide", "local", "location"]),
  wide_mode: geofenceSubmissionSchema.shape.wide_mode,
  shape: geofenceSubmissionSchema.shape.shape,
  name: z.string().trim().max(200).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
});

/**
 * A watcher changes one of their own areas. Renaming keeps the area (and the
 * time it came into effect). Redrawing it, or changing its kind or direction,
 * makes a NEW area with a new reference from now, and ends the old one at the
 * same moment: both stay in the dated record, so a later shape can never be
 * passed off as an earlier one.
 */
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const sender = await enforceRateLimits(request, [{ name: "watch-area:hour", windowSeconds: 3600, max: 30 }]);
  await assertSenderAllowed(sender, requestCountry(request));
  const { watcher, token, fence } = await ownFence(ctx);
  if (fence.status !== "active") throw new HttpError(404, "This area has been removed");
  const input = await parseJson(request, editSchema);
  const areas = await loadWatchAreas(watcher.id, token);
  const current = areas.find((a) => a.id === fence.id);
  if (current && sameArea(current, input.tier, input.wide_mode ?? null, input.shape)) {
    // Rename only: same area, same effective time.
    const description = [input.name, input.note].filter(Boolean).join("\n\n") || null;
    const sealed = current.sealed ? await resealWithName(token, fence.id, input.name, input.note) : null;
    const { error } = await createServiceClient().rpc("rename_watch_area", {
      p_id: fence.id,
      p_watcher_id: watcher.id,
      p_description: current.sealed ? null : description,
      p_sealed: sealed,
    });
    if (error) throw error;
    return json({ ok: true, reference: fence.reference, replaced: false });
  }
  let row;
  try {
    row = await buildWatchArea({
      tier: input.tier,
      mode: input.wide_mode ?? null,
      shape: input.shape,
      name: input.name,
      note: input.note,
      token,
      others: tierContext(areas, fence.id),
      bounds: parseBounds(optionalEnv("GEOFENCE_BOUNDS")),
    });
  } catch (err) {
    if (err instanceof GeofenceValidationError) throw new HttpError(422, err.message);
    throw err;
  }
  // A Location moved near the edge of a Want circle: that circle grows (checked before saving).
  let growth: Awaited<ReturnType<typeof buildWantGrowth>> = [];
  if (row.grow_want?.length && input.shape.type === "location") {
    try {
      growth = await buildWantGrowth({ grows: row.grow_want, areas, point: input.shape.center, token, bounds: parseBounds(optionalEnv("GEOFENCE_BOUNDS")), excludeId: fence.id });
    } catch (err) {
      if (err instanceof GeofenceValidationError) throw new HttpError(422, err.message);
      throw err;
    }
  }
  // Redrawn: a new area from now; the old one ends at the same moment.
  const supabase = createServiceClient();
  const reference = makeReference("G");
  const { data: newId, error } = await supabase.rpc("replace_watch_area", {
    p_old_id: fence.id,
    p_reference: reference,
    p_watcher_id: watcher.id,
    p_tier: row.tier,
    p_wide_mode: row.wide_mode,
    p_geojson: row.geojson,
    p_shape_type: row.shape_type,
    p_center_lat: row.center_lat,
    p_center_lng: row.center_lng,
    p_radius_m: row.radius_m,
    p_description: row.description,
    p_sealed: row.sealed,
    p_submitter_hash: sender,
  });
  if (error) {
    if (/invalid geometry|geofences_|check constraint/i.test(error.message)) throw new HttpError(422, "The area could not be accepted. Please redraw it.");
    throw error;
  }
  const country = requestCountry(request);
  if (country) await supabase.from("geofences").update({ submitter_country: country }).eq("id", newId as string);
  const now = new Date().toISOString();
  await supabase.from("geofence_events").insert([
    { geofence_id: fence.id, event_type: "withdrawn", observed_at: now },
    { geofence_id: newId as string, event_type: "submitted", observed_at: now },
  ]);
  await auditSystem("anonymous", { action: "geofence.replaced_by_watcher", resourceType: "geofence", resourceId: newId as string });
  if (growth.length) await applyWantGrowth(growth, watcher.id, sender);
  await updateLiveStatus().catch(() => undefined);
  const messages = [...(row.grew ? [grewMessage(row.grew)] : []), ...growth.map((g) => grewMessage(g.row.grew!, g.name))];
  return json({ ok: true, reference, replaced: true, message: messages.join(" ") || null });
});

/** A watcher removes one of their own areas. */
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-area:hour", windowSeconds: 3600, max: 30 }]);
  const { fence } = await ownFence(ctx);
  if (fence.status === "active") {
    const supabase = createServiceClient();
    await supabase.from("geofences").update({ status: "withdrawn", updated_at: new Date().toISOString() }).eq("id", fence.id);
    await resetState(fence.id);
    await supabase.from("geofence_events").insert({ geofence_id: fence.id, event_type: "withdrawn", observed_at: new Date().toISOString() });
    await auditSystem("anonymous", { action: "geofence.withdrawn_by_watcher", resourceType: "geofence", resourceId: fence.id });
    await updateLiveStatus();
  }
  return json({ ok: true });
});
