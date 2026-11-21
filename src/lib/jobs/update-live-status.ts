import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { nextState, DEFAULT_HYSTERESIS } from "@/lib/geofence/hysteresis";
import { buildPolicy, type PublicationRuleRow } from "@/lib/publication";
import {
  LIVE_STATUS_META,
  computeLiveStatus,
  homeSignedDistance,
  isOnTheMove,
  publicMarkerPosition,
  type LiveStatus,
} from "@/lib/live-status";
import { liveHoldMs } from "@/lib/env";
import { notifyAdmins } from "@/lib/notify";
import { MIN_GRID_M } from "@/lib/publication";

interface Obs {
  observed_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
}

/**
 * Recompute the live status marker. Call after live GPS ingestion (with the
 * newly inserted observations, so the home-range hysteresis sees every
 * reading) or with none to refresh staleness. Historical imports never call it.
 */
export async function updateLiveStatus(newObservations: Obs[] = []): Promise<LiveStatus> {
  const supabase = createServiceClient();
  const [{ data: rules }, { data: row }, { data: recent }, { data: inside, error: insideErr }, { data: insideOwn }] =
    await Promise.all([
      supabase.from("publication_rules").select("rule_type, configuration, enabled"),
      supabase.from("live_status").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("location_observations")
        .select("observed_at, lat, lng, accuracy_m, metadata")
        .in("source", ["followmee", "ingest_api"])
        .order("observed_at", { ascending: false })
        .limit(2),
      // Watchers' Wish and Want areas count here (I'm told about those);
      // Locations are private to their watcher.
      supabase
        .from("geofence_state")
        .select("geofence_id, geofences!inner(status, tier)")
        .eq("inside", true)
        .eq("geofences.status", "active")
        .in("geofences.tier", ["wide", "local"]),
      // My own (admin) areas: red for everyone.
      supabase
        .from("geofence_state")
        .select("geofence_id, geofences!inner(status, origin)")
        .eq("inside", true)
        .eq("geofences.status", "active")
        .eq("geofences.origin", "admin"),
    ]);
  // My own bans (events) count like my own areas: red for everyone while I'm in one.
  const inOwnerEvent = await import("@/lib/events/server").then((m) => m.insideOwnerEvent()).catch(() => false);
  const ownInside = (insideOwn ?? []).length > 0 || inOwnerEvent;
  if (insideErr) throw insideErr;
  const readings = (recent ?? []).map((r) => ({
    observed_at: r.observed_at as string,
    lat: r.lat as number,
    lng: r.lng as number,
    accuracy_m: r.accuracy_m as number | null,
    speed_kmh: ((r.metadata as Record<string, unknown> | null)?.speed_kmh as number | null | undefined) ?? null,
  }));
  const latest = readings[0] ?? null;
  const moving = isOnTheMove(readings);

  const ruleRows = (rules ?? []) as PublicationRuleRow[];
  const policy = buildPolicy(ruleRows);
  const homeRule = ruleRows.find((r) => r.rule_type === "home_range" && r.enabled);
  const liveRule = ruleRows.find((r) => r.rule_type === "live_status");
  const gridM = Math.max(MIN_GRID_M, Number(liveRule?.configuration.grid_m ?? 1000));
  const home =
    homeRule && Number.isFinite(Number(homeRule.configuration.lat))
      ? {
          lat: Number(homeRule.configuration.lat),
          lng: Number(homeRule.configuration.lng),
          radiusM: Number(homeRule.configuration.radius_m),
        }
      : null;

  // Home-range hysteresis over every new reading, in time order.
  let homeState = {
    inside: row?.home_inside ?? true,
    pendingInside: row?.home_pending_inside ?? null,
    pendingCount: row?.home_pending_count ?? 0,
  };
  let homeInside: boolean | null = home ? (row?.home_inside ?? null) : null;
  if (home) {
    const readings = [...newObservations].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
    if (homeInside === null && latest) {
      // First evaluation: seed directly from the latest position.
      homeState = { inside: homeSignedDistance(latest, home) >= 0, pendingInside: null, pendingCount: 0 };
    }
    for (const o of readings) {
      homeState = nextState(homeState, { signedDistanceM: homeSignedDistance(o, home), accuracyM: o.accuracy_m }, DEFAULT_HYSTERESIS).state;
    }
    homeInside = homeState.inside;
  }

  const stale = !latest || Date.now() - Date.parse(latest.observed_at) > liveHoldMs();
  const status = computeLiveStatus({
    stale,
    insideFenceIds: new Set((inside ?? []).map((r) => r.geofence_id as string)),
    homeInside,
    insideOwn: ownInside,
    insideWant: (inside ?? []).some((r) => (r.geofences as unknown as { tier: string } | null)?.tier === "local"),
  });
  // The public sees only the home-based colour (green / yellow); amber, red and
  // purple are shown only to the watcher whose areas caused them (lib/watchers.ts).
  const publicStatus = computeLiveStatus({ stale, insideFenceIds: new Set(), homeInside, insideOwn: ownInside });
  const pos = publicMarkerPosition(status, latest ?? null, gridM, policy.exclusionZones);
  const changed = row?.status !== status;
  const now = new Date().toISOString();

  const record: Record<string, unknown> = {
    id: 1,
    status,
    public_status: publicStatus,
    public_lat: pos?.lat ?? null,
    public_lng: pos?.lng ?? null,
    cell_size_m: pos ? gridM : null,
    observed_at: latest?.observed_at ?? null,
    status_since: changed ? now : (row?.status_since ?? now),
    home_inside: home ? homeState.inside : null,
    home_pending_inside: home ? homeState.pendingInside : null,
    home_pending_count: home ? homeState.pendingCount : 0,
    updated_at: now,
    moving,
  };
  let { error } = await supabase.from("live_status").upsert(record);
  if (error && /moving/.test(error.message)) {
    // Migration 0008 not applied yet: save without the new column.
    delete record.moving;
    ({ error } = await supabase.from("live_status").upsert(record));
  }
  if (error) throw error;

  if (changed && row) {
    await notifyAdmins({
      event: "live_status_changed",
      title: `Live status: ${LIVE_STATUS_META[status].label}`,
      body: `Changed from ${LIVE_STATUS_META[(row.status as LiveStatus) ?? "unknown"]?.label ?? row.status} to ${LIVE_STATUS_META[status].label}.`,
      url: "/admin/map",
    });
  }
  return status;
}
