import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { loadOkayZone } from "@/lib/home";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";
import { baseZoneAt, watchZoneAt, zoneAt, type BaseZone, type WatchZone, type Zone, type ZoneArea } from "@/lib/geofence/tiers";
import { colouredRouteSegments } from "@/lib/route";
import type { PublicHistoryRecord } from "@/lib/public-data";
import type { LatLng } from "@/lib/geo";

/** What decides the public colours: the okay zone and my own (admin) noted areas. Server-side only. */
export interface PublicZoneContext {
  okay: (LatLng & { radiusM: number }) | null;
  own: AreaGeometry[];
}

export async function loadPublicZoneContext(): Promise<PublicZoneContext> {
  const [okay, { data }] = await Promise.all([
    loadOkayZone().catch(() => null),
    createServiceClient().from("geofences_geojson").select("geojson").eq("origin", "admin").eq("status", "active"),
  ]);
  return { okay, own: ((data ?? []) as { geojson: AreaGeometry | null }[]).flatMap((r) => (r.geojson ? [r.geojson] : [])) };
}

export const publicZone = (p: LatLng, ctx: PublicZoneContext): BaseZone => baseZoneAt(p, ctx.okay, ctx.own);

/**
 * Colours for a stretch of published history. Without watcher areas: what
 * everyone sees (green / yellow / red). With them: the route in the watcher's
 * colours too, and each stop's watcher colour.
 */
export function colourHistory(
  records: PublicHistoryRecord[],
  ctx: PublicZoneContext,
  watchAreas?: readonly ZoneArea[],
): { route: { zone: Zone; coords: [number, number][] }[]; stopZones: Record<string, BaseZone>; watchZones?: Record<string, WatchZone | null> } {
  const route = watchAreas
    ? colouredRouteSegments<Zone>(records, (q, t) => zoneAt(q, ctx.okay, watchAreas, ctx.own, t))
    : colouredRouteSegments<Zone>(records, (q) => publicZone(q, ctx));
  const stopZones: Record<string, BaseZone> = {};
  const watchZones: Record<string, WatchZone | null> = {};
  for (const r of records) {
    if (r.kind !== "visit") continue;
    const p = { lat: r.public_lat, lng: r.public_lng };
    stopZones[r.id] = publicZone(p, ctx);
    if (watchAreas) watchZones[r.id] = watchZoneAt(p, watchAreas, Date.parse(r.observed_at));
  }
  return watchAreas ? { route, stopZones, watchZones } : { route, stopZones };
}
