import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import { isValidLatLng, withinBounds, circleRing, type Bounds, type LatLng } from "@/lib/geo";
import { areaM2, areaWithin, pointInArea, type AreaGeometry } from "@/lib/geofence/area-geometry";
import {
  GeofenceValidationError,
  normaliseGeofence,
  type GeofenceSubmission,
} from "@/lib/geofence/submission";
import {
  blurLocation,
  checkAreaRules,
  grownLocalRadius,
  wantCirclesToGrow,
  shiftedHome,
  type TierContextArea,
  type Tier,
  type WideMode,
  type ZoneArea,
} from "@/lib/geofence/tiers";
import { areaKeyFor, pointKeyFor, seal, unescrowAreaKey, unseal, type SealedArea } from "@/lib/watch-seal";
import { loadHome } from "@/lib/home";
import { makeReference } from "@/lib/crypto";

type Shape = GeofenceSubmission["shape"];

/** One of a watcher's areas, fully readable (only ever built with their link). */
export interface WatchArea {
  id: string;
  reference: string;
  tier: Tier;
  mode: WideMode | null;
  kind: "shape" | "beyond_home" | "location";
  name: string;
  note: string;
  /** Server-side geometry (for beyond-home: the off-centre circle, never sent to the browser). */
  geometry: AreaGeometry;
  /** The shape as drawn, for editing (null for beyond-home: only its distance). */
  shape: Shape | null;
  /** Beyond-home distance, or a location's chosen radius. */
  distance_m: number | null;
  /** Location only: the blurred circle's radius. */
  blurred_radius_m: number | null;
  area_m2: number;
  sealed: boolean;
  submitted_at: string;
  /** When this area came into effect (never before 18 Nov 2026 20:00 GMT). */
  effective_from: string;
}

const splitDescription = (d: string | null) => {
  const [name = "", ...rest] = (d ?? "").split("\n\n");
  return { name, note: rest.join("\n\n") };
};

function shapeFromPlain(row: { shape_type: string; center_lat: number | null; center_lng: number | null; radius_m: number | null; geojson: AreaGeometry }, name: string): Shape | null {
  if (row.shape_type === "beyond_home") return null;
  if (row.shape_type === "circle" && row.center_lat != null && row.center_lng != null && row.radius_m) {
    return { type: "circle", center: { lat: row.center_lat, lng: row.center_lng }, radius_m: row.radius_m };
  }
  if (row.shape_type === "polygon" && row.geojson.type === "Polygon" && row.geojson.coordinates[0].length <= 51) {
    return { type: "polygon", vertices: row.geojson.coordinates[0].slice(0, -1).map(([lng, lat]) => ({ lat, lng })) };
  }
  return { type: "boundary", name, geojson: row.geojson as never };
}

function shapeFromSealed(s: SealedArea, point: LatLng | null): Shape | null {
  const sh = s.shape;
  if (sh.type === "circle") return { type: "circle", center: sh.center, radius_m: sh.radius_m };
  if (sh.type === "polygon") return { type: "polygon", vertices: sh.vertices };
  if (sh.type === "boundary") return { type: "boundary", name: sh.name, geojson: s.geometry as never };
  return point ? { type: "location", center: point, radius_m: sh.radius_m } : null;
}

/**
 * All of a watcher's active areas, readable. Needs their link (`token`).
 * Want (local) areas sealed before 18 Nov 2026 are opened up (the owner sees
 * them now), keeping their effective time. Locations stay sealed.
 */
export async function loadWatchAreas(watcherId: string, token: string): Promise<WatchArea[]> {
  const supabase = createServiceClient();
  const areaKey = areaKeyFor(token);
  const pointKey = pointKeyFor(token);

  // Seal any legacy plain locations first (Want areas are stored openly now).
  const { data: legacy } = await supabase.rpc("unsealed_watch_areas", { p_watcher_id: watcherId });
  for (const r of ((legacy ?? []) as { id: string; tier: string; shape_type: string; center_lat: number | null; center_lng: number | null; radius_m: number | null; description: string | null; geojson: AreaGeometry }[]).filter((x) => x.tier === "location")) {
    const { name, note } = splitDescription(r.description);
    const shape = shapeFromPlain(r, name);
    const payload: SealedArea = {
      name,
      note,
      geometry: r.geojson as SealedArea["geometry"],
      shape: !shape || shape.type === "beyond_home" || shape.type === "location" ? { type: "boundary", name } : shape.type === "boundary" ? { type: "boundary", name: shape.name } : shape,
    };
    await supabase
      .from("geofences")
      .update({ sealed: seal(areaKey, payload), geometry: null, shape_type: "polygon", center_lat: null, center_lng: null, radius_m: null, description: null, updated_at: new Date().toISOString() })
      .eq("id", r.id);
  }

  const { data: sealedWant } = await supabase.from("geofences").select("id, sealed").eq("watcher_id", watcherId).eq("status", "active").eq("tier", "local").not("sealed", "is", null);
  for (const r of (sealedWant ?? []) as { id: string; sealed: string }[]) {
    try {
      const sa = unseal<SealedArea>(areaKey, r.sealed);
      const sh = sa.shape;
      await supabase.rpc("reveal_want_area", {
        p_id: r.id,
        p_geojson: JSON.stringify(sa.geometry),
        p_shape_type: sh.type === "circle" ? "circle" : sh.type === "polygon" ? "polygon" : "boundary",
        p_center_lat: sh.type === "circle" ? sh.center.lat : null,
        p_center_lng: sh.type === "circle" ? sh.center.lng : null,
        p_radius_m: sh.type === "circle" ? sh.radius_m : null,
        p_description: [sa.name, sa.note].filter(Boolean).join("\n\n") || null,
      });
    } catch {
      // not readable with this link: leave it
    }
  }

  const [{ data: plain }, { data: sealedRows }] = await Promise.all([
    supabase
      .from("geofences_geojson")
      .select("id, reference, tier, wide_mode, shape_type, center_lat, center_lng, radius_m, description, geojson, submitted_at, effective_from")
      .eq("watcher_id", watcherId)
      .eq("status", "active"),
    supabase.from("geofences").select("id, reference, tier, sealed, submitted_at, effective_from").eq("watcher_id", watcherId).eq("status", "active").not("sealed", "is", null),
  ]);

  const out: WatchArea[] = [];
  for (const r of (plain ?? []) as { id: string; reference: string; tier: Tier | null; wide_mode: WideMode | null; shape_type: string; center_lat: number | null; center_lng: number | null; radius_m: number | null; description: string | null; geojson: AreaGeometry; submitted_at: string; effective_from: string | null }[]) {
    const { name, note } = splitDescription(r.description);
    const beyond = r.shape_type === "beyond_home";
    const isWide = (r.tier ?? "wide") === "wide";
    out.push({
      id: r.id,
      reference: r.reference,
      tier: r.tier ?? "wide",
      mode: beyond ? "outside" : isWide ? (r.wide_mode ?? "inside") : null,
      kind: beyond ? "beyond_home" : "shape",
      name,
      note,
      geometry: r.geojson,
      shape: shapeFromPlain(r, name),
      distance_m: beyond ? r.radius_m : null,
      blurred_radius_m: null,
      area_m2: areaM2(r.geojson),
      sealed: false,
      submitted_at: r.submitted_at,
      effective_from: r.effective_from ?? r.submitted_at,
    });
  }
  for (const r of (sealedRows ?? []) as { id: string; reference: string; tier: Tier; sealed: string; submitted_at: string; effective_from: string | null }[]) {
    let s: SealedArea;
    try {
      s = unseal<SealedArea>(areaKey, r.sealed);
    } catch {
      continue; // not readable with this link (should not happen)
    }
    let point: LatLng | null = null;
    if (s.point) {
      try {
        point = unseal<LatLng>(pointKey, s.point);
      } catch {
        point = null;
      }
    }
    const isLocation = s.shape.type === "location";
    out.push({
      id: r.id,
      reference: r.reference,
      tier: r.tier,
      mode: null,
      kind: isLocation ? "location" : "shape",
      name: s.name,
      note: s.note,
      geometry: s.geometry,
      shape: shapeFromSealed(s, point),
      distance_m: s.shape.type === "location" ? s.shape.radius_m : null,
      blurred_radius_m: s.shape.type === "location" ? s.shape.blurred_radius_m : null,
      area_m2: areaM2(s.geometry),
      sealed: true,
      submitted_at: r.submitted_at,
      effective_from: r.effective_from ?? r.submitted_at,
    });
  }
  const order: Record<Tier, number> = { wide: 0, local: 1, location: 2 };
  return out.sort((a, b) => order[a.tier] - order[b.tier] || a.submitted_at.localeCompare(b.submitted_at));
}

export const tierContext = (areas: WatchArea[], excludeId?: string): TierContextArea[] =>
  areas
    .filter((a) => a.id !== excludeId)
    .map((a) => ({
      id: a.id,
      tier: a.tier,
      mode: a.mode,
      geometry: a.kind === "beyond_home" ? null : a.geometry,
      point: a.shape?.type === "location" ? a.shape.center : null,
      circle: a.tier === "local" && a.shape?.type === "circle" ? { center: a.shape.center, radius_m: a.shape.radius_m } : null,
    }));

export const zoneAreas = (areas: WatchArea[]): ZoneArea[] =>
  areas.map((a) => ({ tier: a.tier, mode: a.mode, geometry: a.geometry, from: Date.parse(a.effective_from) }));

/** Arguments for the save_watch_area database function. */
export interface WatchAreaRow {
  tier: Tier;
  wide_mode: WideMode | null;
  geojson: string | null;
  shape_type: string;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  description: string | null;
  sealed: string | null;
  /** A Want circle made bigger to keep Locations 250 m inside it. */
  grew?: { from_m: number; to_m: number };
  /** A new Location: Want circles that must grow to keep it 250 m inside. */
  grow_want?: { id: string; radius_m: number }[];
}

const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

/**
 * Check a watcher's new or changed area against the tier rules and build the
 * row to store. Wide areas are stored plainly; local areas and locations are
 * sealed with the watcher's link. Throws GeofenceValidationError for the watcher.
 */
export async function buildWatchArea(input: {
  tier: Tier;
  mode: WideMode | null;
  shape: Shape;
  name: string;
  note: string;
  token: string;
  others: TierContextArea[];
  bounds: Bounds;
}): Promise<WatchAreaRow> {
  const { tier, name, note, token, others, bounds } = input;
  let shape = input.shape;
  const description = [name, note].filter(Boolean).join("\n\n") || null;

  if (tier === "location") {
    if (shape.type !== "location") throw new GeofenceValidationError("Choose the place and how far around it to watch");
    if (!isValidLatLng(shape.center.lat, shape.center.lng) || !withinBounds(shape.center, bounds)) {
      throw new GeofenceValidationError("That place is outside the supported region");
    }
    const blurred = blurLocation(shape.center, shape.radius_m, rand(), rand());
    const geometry: SealedArea["geometry"] = { type: "Polygon", coordinates: [circleRing(blurred.center, blurred.radiusM, 64)] };
    // Never one Location inside another.
    for (const o of others) {
      if (o.tier !== "location" || !o.geometry) continue;
      if (pointInArea(shape.center, o.geometry) || areaWithin(o.geometry, geometry as AreaGeometry)) {
        throw new GeofenceValidationError("A Location can't be inside another Location. Change the other Location instead.");
      }
    }
    const payload: SealedArea = {
      name,
      note,
      geometry,
      shape: { type: "location", radius_m: shape.radius_m, blurred_radius_m: Math.round(blurred.radiusM) },
      point: seal(pointKeyFor(token), shape.center),
    };
    const grow_want = wantCirclesToGrow(shape.center, others, rand);
    return { tier, wide_mode: null, geojson: null, shape_type: "polygon", center_lat: null, center_lng: null, radius_m: null, description: null, sealed: seal(areaKeyFor(token), payload), grow_want };
  }

  if (shape.type === "location") throw new GeofenceValidationError("Draw an area, or search for a place");

  if (shape.type === "beyond_home") {
    if (tier !== "wide") throw new GeofenceValidationError("“Anywhere beyond home” is a wide area");
    const home = await loadHome();
    if (!home) throw new GeofenceValidationError("“Anywhere beyond home” isn't available yet");
    // Off-centre, so the colour changes never trace back to home itself.
    const n = normaliseGeofence(shape, bounds, shiftedHome(home, shape.distance_m, rand(), rand()));
    return { tier, wide_mode: "outside", geojson: n.geojson, shape_type: n.shapeType, center_lat: null, center_lng: null, radius_m: n.radiusM, description, sealed: null };
  }

  // A Want circle grows so every Location inside it is at least 250 m from its edge.
  let grew: WatchAreaRow["grew"];
  if (tier === "local" && shape.type === "circle") {
    const points = others.filter((o) => o.tier === "location" && o.point).map((o) => o.point!);
    const r = grownLocalRadius(shape.center, shape.radius_m, points, rand);
    if (r > shape.radius_m) {
      grew = { from_m: shape.radius_m, to_m: r };
      shape = { ...shape, radius_m: r };
    }
  }

  const n = normaliseGeofence(shape, bounds);
  const geometry = JSON.parse(n.geojson) as AreaGeometry;
  try {
    checkAreaRules({ tier, geometry, areaM2: n.areaM2, isNamedPlace: shape.type === "boundary", isCircle: shape.type === "circle", others });
  } catch (e) {
    throw new GeofenceValidationError(e instanceof Error ? e.message : "This area isn't allowed");
  }

  if (tier === "wide" || tier === "local") {
    // Wish and Want areas are stored openly: the owner sees them.
    return {
      tier,
      wide_mode: tier === "wide" ? (input.mode ?? "inside") : null,
      geojson: n.geojson,
      shape_type: n.shapeType,
      center_lat: n.shapeType === "circle" ? n.center.lat : null,
      center_lng: n.shapeType === "circle" ? n.center.lng : null,
      radius_m: n.radiusM,
      description,
      sealed: null,
      grew,
    };
  }
  const payload: SealedArea = {
    name,
    note,
    geometry: geometry as SealedArea["geometry"],
    shape: shape.type === "circle" ? shape : shape.type === "polygon" ? shape : { type: "boundary", name: shape.name },
  };
  return { tier, wide_mode: null, geojson: null, shape_type: "polygon", center_lat: null, center_lng: null, radius_m: null, description: null, sealed: seal(areaKeyFor(token), payload) };
}

const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

/** What to tell the watcher when a Want circle was made bigger. */
export const grewMessage = (g: { from_m: number; to_m: number }, name?: string) =>
  `${name ? `“${name}”` : "Your Want circle"} was made bigger (radius ${fmtKm(g.from_m)} → ${fmtKm(g.to_m)}) so your Locations inside it are at least 250 m from its edge.`;

/**
 * Build the grown Want circles a new Location needs (before anything is saved,
 * so a circle that can't grow refuses the Location instead).
 */
export async function buildWantGrowth(input: {
  grows: { id: string; radius_m: number }[];
  areas: WatchArea[];
  point: LatLng;
  token: string;
  bounds: Bounds;
  excludeId?: string;
}): Promise<{ id: string; row: WatchAreaRow; name: string; from_m: number }[]> {
  const out: { id: string; row: WatchAreaRow; name: string; from_m: number }[] = [];
  for (const g of input.grows) {
    const want = input.areas.find((a) => a.id === g.id);
    if (!want || want.shape?.type !== "circle") continue;
    const others = [...tierContext(input.areas, want.id).filter((o) => o.id !== input.excludeId), { id: "new-location", tier: "location" as const, mode: null, geometry: null, point: input.point }];
    try {
      const row = await buildWatchArea({
        tier: "local",
        mode: null,
        shape: { type: "circle", center: want.shape.center, radius_m: g.radius_m },
        name: want.name,
        note: want.note,
        token: input.token,
        others,
        bounds: input.bounds,
      });
      out.push({ id: want.id, row: { ...row, grew: { from_m: want.shape.radius_m, to_m: row.radius_m ?? g.radius_m } }, name: want.name || want.reference, from_m: want.shape.radius_m });
    } catch (err) {
      const why = err instanceof Error ? err.message : "";
      throw new GeofenceValidationError(
        `This Location is less than 250 m from the edge of your Want area “${want.name || want.reference}”, and that circle can't grow to fit it (${why.replace(/\.$/, "")}). Make the Want area bigger first, or choose a point further in.`,
      );
    }
  }
  return out;
}

/** Replace Want circles with their grown versions (new references from now; the old ones end at the same moment). */
export async function applyWantGrowth(growth: { id: string; row: WatchAreaRow }[], watcherId: string, submitterHash: string | null): Promise<void> {
  const supabase = createServiceClient();
  for (const { id, row } of growth) {
    const { data: newId, error } = await supabase.rpc("replace_watch_area", {
      p_old_id: id,
      p_reference: makeReference("G"),
      p_watcher_id: watcherId,
      p_tier: row.tier,
      p_wide_mode: row.wide_mode,
      p_geojson: row.geojson,
      p_shape_type: row.shape_type,
      p_center_lat: row.center_lat,
      p_center_lng: row.center_lng,
      p_radius_m: row.radius_m,
      p_description: row.description,
      p_sealed: row.sealed,
      p_submitter_hash: submitterHash,
    });
    if (error) throw error;
    const now = new Date().toISOString();
    await supabase.from("geofence_events").insert([
      { geofence_id: id, event_type: "withdrawn", observed_at: now },
      { geofence_id: newId as string, event_type: "submitted", observed_at: now },
    ]);
  }
}

/** Save a watch area row (new when id is null). Returns its id. */
export async function saveWatchArea(row: WatchAreaRow, opts: { id: string | null; reference: string; watcherId: string; withdrawalCodeHash?: string | null; submitterHash?: string | null }) {
  const { data, error } = await createServiceClient().rpc("save_watch_area", {
    p_id: opts.id,
    p_reference: opts.reference,
    p_watcher_id: opts.watcherId,
    p_tier: row.tier,
    p_wide_mode: row.wide_mode,
    p_geojson: row.geojson,
    p_shape_type: row.shape_type,
    p_center_lat: row.center_lat,
    p_center_lng: row.center_lng,
    p_radius_m: row.radius_m,
    p_description: row.description,
    p_sealed: row.sealed,
    p_withdrawal_code_hash: opts.withdrawalCodeHash ?? null,
    p_submitter_hash: opts.submitterHash ?? null,
  });
  if (error) {
    if (/invalid geometry|geofences_|check constraint/i.test(error.message)) throw new HttpError(422, "The area could not be accepted. Please redraw it.");
    throw error;
  }
  return data as string;
}

/** Sealed areas of watchers who turned on red/purple alerts (for the alert job). */
export async function loadAlertSealedAreas(): Promise<{ id: string; reference: string; geometry: AreaGeometry; sample: boolean; name: string }[]> {
  const supabase = createServiceClient();
  const [{ data: watchers }, sample] = await Promise.all([
    supabase.from("watchers").select("id, alert_key").eq("status", "active").not("alert_key", "is", null),
    import("@/lib/sample-watcher").then((m) => m.loadSampleWatcher()).catch(() => null),
  ]);
  const keys = new Map<string, Buffer>();
  for (const w of (watchers ?? []) as { id: string; alert_key: string }[]) {
    const k = unescrowAreaKey(w.alert_key);
    if (k) keys.set(w.id, k);
  }
  // The public sample's Locations are always checked (they're public anyway).
  if (sample) keys.set(sample.watcherId, areaKeyFor(sample.token));
  if (!keys.size) return [];
  const { data: rows } = await supabase
    .from("geofences")
    .select("id, reference, watcher_id, sealed")
    .eq("status", "active")
    .not("sealed", "is", null)
    .in("watcher_id", [...keys.keys()]);
  const out: { id: string; reference: string; geometry: AreaGeometry; sample: boolean; name: string }[] = [];
  for (const r of (rows ?? []) as { id: string; reference: string; watcher_id: string; sealed: string }[]) {
    try {
      const s = unseal<SealedArea>(keys.get(r.watcher_id)!, r.sealed);
      out.push({ id: r.id, reference: r.reference, geometry: s.geometry, sample: r.watcher_id === sample?.watcherId, name: s.name });
    } catch {
      // key changed (secret rotated): skipped until the watcher opens their page
    }
  }
  return out;
}
