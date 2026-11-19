import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { nextState, DEFAULT_HYSTERESIS, type GeofenceRuntimeState } from "@/lib/geofence/hysteresis";
import { notifyAdmins } from "@/lib/notify";
import { notifyWatchersOfEvents } from "@/lib/watchers";

export type ObservationSource = "followmee" | "google_timeline" | "manual" | "ingest_api";

export interface ObservationInput {
  sourceRecordId: string;
  observedAt: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  deviceId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface InsertResult {
  inserted: { id: string; observed_at: string; lat: number; lng: number; accuracy_m: number | null }[];
  duplicates: number;
}

const CHUNK = 1000;

/**
 * Idempotent insert. Rows whose (source, source_record_id) already exists are
 * ignored — re-polling or re-importing never duplicates observations.
 */
export async function insertObservations(
  supabase: SupabaseClient,
  source: ObservationSource,
  batchId: string | null,
  rows: ObservationInput[],
): Promise<InsertResult> {
  const inserted: InsertResult["inserted"] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      source,
      source_record_id: r.sourceRecordId,
      device_id: r.deviceId ?? null,
      observed_at: r.observedAt,
      lat: r.lat,
      lng: r.lng,
      accuracy_m: r.accuracyM,
      import_batch_id: batchId,
      metadata: r.metadata ?? {},
    }));
    const { data, error } = await supabase
      .from("location_observations")
      .upsert(chunk, { onConflict: "source,source_record_id", ignoreDuplicates: true })
      .select("id, observed_at, lat, lng, accuracy_m");
    if (error) throw error;
    inserted.push(...(data ?? []));
  }
  return { inserted, duplicates: rows.length - inserted.length };
}

/**
 * Evaluate newly inserted LIVE observations against active geofences and record
 * enter/exit events. Historical imports are not evaluated (they would generate
 * stale alerts for past movements).
 *
 * With no new readings (FollowMee is silent while the phone is still), the last
 * known position is checked against areas that have never been checked (a new
 * area, or one only just being watched), so being already inside one is
 * noticed without having to move first.
 */
export async function evaluateGeofences(
  observations: InsertResult["inserted"],
): Promise<{ enter: number; exit: number }> {
  const supabase = createServiceClient();
  let onlyNewAreas = false;
  let sorted = [...observations].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  if (!sorted.length) {
    const { data: last } = await supabase
      .from("location_observations")
      .select("id, observed_at, lat, lng, accuracy_m")
      .in("source", ["followmee", "ingest_api"])
      .eq("validation_status", "valid")
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last) return { enter: 0, exit: 0 };
    sorted = [last as InsertResult["inserted"][number]];
    onlyNewAreas = true;
  }

  const { data: stateRows, error: stateErr } = await supabase
    .from("geofence_state")
    .select("geofence_id, inside, pending_inside, pending_count, last_observed_at");
  if (stateErr) throw stateErr;
  const states = new Map<string, GeofenceRuntimeState & { last?: string | null }>();
  for (const s of stateRows ?? []) {
    states.set(s.geofence_id, {
      inside: s.inside,
      pendingInside: s.pending_inside,
      pendingCount: s.pending_count,
      last: s.last_observed_at,
    });
  }

  const events: Record<string, unknown>[] = [];
  const notices: { id: string; type: "enter" | "exit"; reference: string; observedAt: string }[] = [];
  const entries: { geofenceId: string; observedAt: string; lat: number; lng: number; accuracyM: number | null }[] = [];
  const touched = new Set<string>();
  // Sealed local areas and locations of watchers who turned on alerts for them
  // (checked here in code: the database can't read them). Their entries never
  // reach the owner's notifications.
  const { loadAlertSealedAreas } = await import("@/lib/watch-areas");
  const { signedDistanceM } = await import("@/lib/geofence/area-geometry");
  const sealedAreas = await loadAlertSealedAreas().catch((err) => {
    console.error("sealed areas could not be loaded", err);
    return [];
  });
  // Real watchers' Locations are private: their entries only go to that watcher.
  // The public sample's Locations also notify me.
  const sealedIds = new Set(sealedAreas.filter((a) => !a.sample).map((a) => a.id));
  const sampleNames = new Map(sealedAreas.filter((a) => a.sample).map((a) => [a.id, a.name]));

  for (const obs of sorted) {
    const { data: distances, error } = await supabase.rpc("geofence_signed_distances", {
      p_lat: obs.lat,
      p_lng: obs.lng,
    });
    if (error) throw error;
    const nearby = new Map<string, { reference: string; d: number }>(
      (distances ?? []).map((r: { geofence_id: string; reference: string; signed_distance_m: number }) => [
        r.geofence_id,
        { reference: r.reference, d: r.signed_distance_m },
      ]),
    );
    for (const a of sealedAreas) nearby.set(a.id, { reference: a.reference, d: signedDistanceM(obs, a.geometry) });
    // Fences we were inside but are now >20 km away are not returned by the RPC;
    // treat them as far outside.
    if (!onlyNewAreas) {
      for (const [id, st] of states) {
        if (st.inside && !nearby.has(id)) nearby.set(id, { reference: "", d: -20_000 });
      }
    }
    for (const [id, { reference, d }] of nearby) {
      if (onlyNewAreas && states.has(id)) continue; // already being watched normally
      const prev = states.get(id) ?? { inside: false, pendingInside: null, pendingCount: 0 };
      if (prev.last && prev.last >= obs.observed_at) continue; // out-of-order reading
      // A never-checked area with the phone standing still: one confident reading is enough.
      const opts = onlyNewAreas ? { ...DEFAULT_HYSTERESIS, confirmations: 1 } : DEFAULT_HYSTERESIS;
      const { state, transition } = nextState(prev, { signedDistanceM: d, accuracyM: obs.accuracy_m }, opts);
      states.set(id, { ...state, last: obs.observed_at });
      touched.add(id);
      if (transition) {
        events.push({
          geofence_id: id,
          event_type: transition,
          observed_at: obs.observed_at,
          location_observation_id: obs.id,
          accuracy_m: obs.accuracy_m,
        });
        if (sealedIds.has(id)) continue; // private to its watcher: push only
        notices.push({ id, type: transition, reference, observedAt: obs.observed_at });
        if (transition === "enter") entries.push({ geofenceId: id, observedAt: obs.observed_at, lat: obs.lat, lng: obs.lng, accuracyM: obs.accuracy_m });
      }
    }
  }

  if (touched.size) {
    const upserts = [...touched].map((id) => {
      const s = states.get(id)!;
      return {
        geofence_id: id,
        inside: s.inside,
        pending_inside: s.pendingInside,
        pending_count: s.pendingCount,
        last_observed_at: s.last,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await supabase.from("geofence_state").upsert(upserts, { onConflict: "geofence_id" });
    if (error) throw error;
  }
  if (events.length) {
    const { error } = await supabase.from("geofence_events").insert(events);
    if (error) throw error;
    await notifyWatchersOfEvents(
      events as { geofence_id: string; event_type: "enter" | "exit"; observed_at: string }[],
    ).catch((err) => console.error("watcher notifications failed", err));
    // Contact alerts (Admin → Settings): email my chosen contacts about entries.
    const { sendContactAlerts } = await import("@/lib/incident-contacts");
    await sendContactAlerts(entries).catch((err) => console.error("contact alerts failed", err));
  }
  // Say which kind of area, and its name, in my own alerts.
  const { data: noticeFences } = notices.length
    ? await supabase.from("geofences").select("id, tier, wide_mode, shape_type, description, watcher_id").in("id", [...new Set(notices.map((n) => n.id))])
    : { data: [] };
  const fenceInfo = new Map((noticeFences ?? []).map((f) => [f.id as string, f]));
  for (const n of notices) {
    const f = fenceInfo.get(n.id);
    const sampleName = sampleNames.get(n.id);
    const kind = sampleName !== undefined ? "sample Location" : !f?.tier ? "my area" : f.tier === "local" ? "Want area" : "Wish area";
    const name = sampleName ?? ((f?.description as string | null) ?? "").split("\n")[0];
    const outside = f?.tier === "wide" && (f.wide_mode === "outside" || f.shape_type === "beyond_home");
    const verb = outside ? (n.type === "enter" ? "Left" : "Back inside") : n.type === "enter" ? "Entered" : "Left";
    const time = new Date(n.observedAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
    await notifyAdmins({
      event: n.type === "enter" ? "geofence_enter" : "geofence_exit",
      title: `${verb} ${kind}${name ? `: ${name}` : ""}`,
      body: `GPS at ${time}: ${verb.toLowerCase()} ${kind} ${n.reference || ""}${name ? ` (${name})` : ""}.`,
      url: "/admin/map",
    });
  }
  return {
    enter: events.filter((e) => e.event_type === "enter").length,
    exit: events.filter((e) => e.event_type === "exit").length,
  };
}

export async function getSystemState<T>(key: string): Promise<T | null> {
  const { data } = await createServiceClient().from("system_state").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}

export async function setSystemState(key: string, value: unknown) {
  await createServiceClient()
    .from("system_state")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
