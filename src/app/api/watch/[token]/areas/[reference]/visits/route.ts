import { handle, HttpError, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { findWatcher, loadOwnerProfile } from "@/lib/watchers";
import { loadWatchAreas } from "@/lib/watch-areas";
import { getPublicHistory } from "@/lib/public-data";
import { pointInArea, type AreaGeometry } from "@/lib/geofence/area-geometry";
import { historyRange } from "@/lib/history-range";
import { areaKeyFor, unseal, type SealedArea } from "@/lib/watch-seal";
import { mergeCoverage, type EvidenceEvent } from "@/lib/area-visits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string; reference: string }> };

/** Nothing counts from before this (owner decision). */
const RECORD_START = Date.parse("2026-11-18T20:00:00Z");

const middle = (g: AreaGeometry) => {
  const ring = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0];
  const lngs = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  return { lng: (Math.min(...lngs) + Math.max(...lngs)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
};

/**
 * Every time I was recorded in one of this watcher's areas, for a period:
 * entries and exits (times only, never positions) and the published stays
 * inside it, before and after the area was set. Also when the area (or an
 * earlier one of theirs for the same place) was in effect, so the list can
 * show what was watched and what wasn't.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-visits:min", windowSeconds: 60, max: 30 }]);
  const { token, reference: rawRef } = await ctx.params;
  const upper = token.toUpperCase();
  const reference = rawRef.toUpperCase();
  const w = await findWatcher(upper);
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  const sp = new URL(request.url).searchParams;
  const { from, to } = historyRange({ from: sp.get("from"), to: sp.get("to") });

  const supabase = createServiceClient();
  const areas = await loadWatchAreas(w.id, upper);
  const area = areas.find((a) => a.reference === reference);
  if (!area) throw new HttpError(404, "That area isn't one of your current areas");
  const outside = area.tier === "wide" && (area.mode === "outside" || area.kind === "beyond_home");

  // This watcher's areas of the same kind, any status: the earlier drawings this
  // one replaced, and earlier areas for the same place (removed, then added again).
  type Row = { id: string; reference: string; status: string; replaces_id: string | null; effective_from: string | null; submitted_at: string; sealed: string | null };
  const [{ data: mine }, { data: plain }] = await Promise.all([
    supabase.from("geofences").select("id, reference, status, replaces_id, effective_from, submitted_at, sealed").eq("watcher_id", w.id).eq("tier", area.tier),
    supabase.from("geofences_geojson").select("id, geojson").eq("watcher_id", w.id).eq("tier", area.tier),
  ]);
  const rows = (mine ?? []) as Row[];
  const shapeOf = new Map(((plain ?? []) as { id: string; geojson: AreaGeometry | null }[]).filter((p) => p.geojson).map((p) => [p.id, p.geojson!]));
  const key = areaKeyFor(upper);
  for (const r of rows) {
    if (shapeOf.has(r.id) || !r.sealed) continue;
    try {
      shapeOf.set(r.id, unseal<SealedArea>(key, r.sealed).geometry as AreaGeometry);
    } catch {
      /* not readable with this link */
    }
  }
  const chainIds = new Set<string>([area.id]);
  for (let cursor = rows.find((r) => r.id === area.id)?.replaces_id ?? null, i = 0; cursor && i < 25; i++) {
    chainIds.add(cursor);
    cursor = rows.find((r) => r.id === cursor)?.replaces_id ?? null;
  }
  const samePlace = (id: string) => {
    if (chainIds.has(id)) return true;
    if (outside) return false; // "beyond home" / "rather I didn't leave": only its own drawings
    const g = shapeOf.get(id);
    return Boolean(g && (pointInArea(middle(g), area.geometry) || pointInArea(middle(area.geometry), g)));
  };
  const related = rows.filter((r) => samePlace(r.id));
  const ids = related.map((r) => r.id);
  const refOf = new Map(related.map((r) => [r.id, r.reference]));

  const startIso = `${from}T00:00:00Z`;
  const endIso = `${to}T23:59:59.999Z`;
  const [{ data: events }, { data: ended }, { data: state }, history, owner] = await Promise.all([
    supabase
      .from("geofence_events")
      .select("geofence_id, event_type, observed_at, accuracy_m")
      .in("geofence_id", ids)
      .in("event_type", ["enter", "exit"])
      .gte("observed_at", startIso)
      .lte("observed_at", endIso)
      .order("observed_at", { ascending: true })
      .limit(5000),
    // When each removed or replaced area stopped counting.
    supabase.from("geofence_events").select("geofence_id, observed_at").in("geofence_id", ids).eq("event_type", "withdrawn").order("observed_at", { ascending: true }),
    supabase.from("geofence_state").select("inside").eq("geofence_id", area.id).maybeSingle(),
    // Stays inside the area (published stays only; not for "anywhere beyond home", whose circle stays private).
    outside ? Promise.resolve(null) : getPublicHistory(startIso, endIso, { stopsOnly: true }),
    loadOwnerProfile(),
  ]);

  const endOf = new Map<string, string>();
  for (const e of (ended ?? []) as { geofence_id: string; observed_at: string }[]) if (!endOf.has(e.geofence_id)) endOf.set(e.geofence_id, e.observed_at);
  // When the place was watched: each related area from when it came into effect until it was removed.
  const coverage = mergeCoverage(
    related.flatMap((r) => {
      const start = Math.max(RECORD_START, Date.parse(r.effective_from ?? r.submitted_at));
      const stop = r.status === "active" ? null : endOf.get(r.id) ?? null;
      if (r.status !== "active" && !stop) return [];
      if (stop && Date.parse(stop) <= start) return [];
      return [{ from: new Date(start).toISOString(), until: stop }];
    }),
  );

  const visitEvents: EvidenceEvent[] = (events ?? []).map((e) => ({
    type: e.event_type as "enter" | "exit",
    at: e.observed_at as string,
    accuracy_m: e.accuracy_m == null ? null : Math.round(Number(e.accuracy_m)),
    reference: refOf.get(e.geofence_id as string) ?? reference,
  }));
  const stays = (history?.records ?? [])
    .filter((r) => r.kind === "visit" && pointInArea({ lat: r.public_lat, lng: r.public_lng }, area.geometry))
    .map((r) => ({ name: r.venue_name ?? r.area_label ?? "A stop", from: r.observed_at, until: r.observed_until }));

  return json(
    {
      generated_at: new Date().toISOString(),
      from,
      to,
      owner_name: owner.name,
      area: { reference: area.reference, tier: area.tier, outside, name: area.name, effective_from: area.effective_from },
      coverage,
      events: visitEvents,
      inside_now: Boolean(state?.inside),
      stays,
    },
    { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } },
  );
});
