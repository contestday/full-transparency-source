import "server-only";
import { geocode, type GeocodeResult } from "@/lib/geocode";
import { circleRing } from "@/lib/geo";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";

// Cached, and at most one request a second to OpenStreetMap's Nominatim.
const cache = new Map<string, { at: number; result: PlaceArea | null }>();
let lastUpstream = 0;

export interface PlaceArea {
  label: string;
  geometry: AreaGeometry;
}

/** A searched place's real outline (towns, islands, counties) or, for a point such as a postcode, a 500 m circle. */
export function placeArea(r: GeocodeResult): PlaceArea {
  if (r.boundary) return { label: r.label, geometry: r.boundary as AreaGeometry };
  const radius = Math.max(500, r.enclosingRadiusM ?? 0);
  return { label: r.label, geometry: { type: "Polygon", coordinates: [circleRing(r, radius, 64)] } };
}

/** Look up a place name for the history search (the first match). */
export async function lookupPlace(q: string): Promise<PlaceArea | null> {
  const key = q.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.result;
  const wait = lastUpstream + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastUpstream = Date.now();
  const results = await geocode(q).catch(() => []);
  const result = results[0] ? placeArea(results[0]) : null;
  cache.set(key, { at: Date.now(), result });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return result;
}
