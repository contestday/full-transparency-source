/**
 * Address / postcode / place search.
 *   - UK postcodes (full or outward code) → postcodes.io (free, no key, UK only)
 *   - Everything else → OpenStreetMap Nominatim (usage policy: ≤1 request/second,
 *     identifying User-Agent, no autocomplete — search runs only on submit)
 *
 * Pure helpers are exported for tests; network calls are server-side only
 * (via /api/geocode) so visitors' browsers never contact third parties directly.
 */

import { haversineMeters, type LatLng } from "@/lib/geo";
import { simplifyBoundary, type Ring } from "@/lib/geo-simplify";

export type GeocodeKind = "postcode" | "address" | "place" | "area";

export interface GeocodeResult {
  label: string;
  /** Short name, e.g. a pub's name, for pre-filling forms. */
  name: string;
  lat: number;
  lng: number;
  kind: GeocodeKind;
  /**
   * For areas (towns, islands, regions): radius of a circle centred on the
   * middle of the area that reaches its furthest point. Null for points.
   */
  enclosingRadiusM: number | null;
  /** For areas: the real outline (simplified), used instead of a circle. */
  boundary?: { type: "Polygon" | "MultiPolygon"; coordinates: Ring[] | Ring[][] } | null;
  source: "postcodes.io" | "openstreetmap";
}

const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

export function classifyQuery(q: string): "postcode" | "outcode" | "text" {
  const t = q.trim();
  if (FULL_POSTCODE.test(t)) return "postcode";
  if (OUTCODE.test(t)) return "outcode";
  return "text";
}

type Position = [number, number];

function collectPositions(geom: unknown, out: Position[] = []): Position[] {
  if (Array.isArray(geom)) {
    if (geom.length >= 2 && typeof geom[0] === "number" && typeof geom[1] === "number") out.push([geom[0], geom[1]]);
    else for (const g of geom) collectPositions(g, out);
  }
  return out;
}

/**
 * Circle centred on the middle of an area (bounding-box centre) whose radius
 * reaches the furthest point of the area's outline. E.g. an island →
 * centred mid-island, radius to its furthest tip.
 */
export function enclosingCircle(
  geojson: { type?: string; coordinates?: unknown } | null | undefined,
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): { center: LatLng; radiusM: number } | null {
  let pts = geojson?.coordinates ? collectPositions(geojson.coordinates) : [];
  if (pts.length < 3 && bbox) {
    pts = [
      [bbox.minLng, bbox.minLat],
      [bbox.maxLng, bbox.minLat],
      [bbox.maxLng, bbox.maxLat],
      [bbox.minLng, bbox.maxLat],
    ];
  }
  if (pts.length < 3) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lng, lat] of pts) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  let radiusM = 0;
  for (const [lng, lat] of pts) radiusM = Math.max(radiusM, haversineMeters(center, { lat, lng }));
  return { center, radiusM: Math.ceil(radiusM) };
}

/** Areas smaller than this are treated as a single point (e.g. a building). */
export const AREA_THRESHOLD_M = 300;

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  class?: string;
  /** jsonv2 uses `category` instead of `class`. */
  category?: string;
  type?: string;
  addresstype?: string;
  boundingbox?: [string, string, string, string];
  geojson?: { type: string; coordinates: unknown };
}

export function fromNominatim(item: NominatimItem): GeocodeResult {
  const bb = item.boundingbox?.map(Number);
  const circle = enclosingCircle(
    item.geojson && /Polygon/.test(item.geojson.type) ? item.geojson : null,
    bb && bb.every(Number.isFinite) ? { minLat: bb[0], maxLat: bb[1], minLng: bb[2], maxLng: bb[3] } : undefined,
  );
  const isArea = circle !== null && circle.radiusM >= AREA_THRESHOLD_M && /Polygon/.test(item.geojson?.type ?? "");
  const point = { lat: Number(item.lat), lng: Number(item.lon) };
  const cls = item.category ?? item.class;
  const kind: GeocodeKind = isArea ? "area" : cls === "place" || cls === "boundary" ? "place" : "address";
  return {
    label: item.display_name,
    name: item.name || item.display_name.split(",")[0].trim(),
    lat: isArea ? circle!.center.lat : point.lat,
    lng: isArea ? circle!.center.lng : point.lng,
    kind,
    enclosingRadiusM: isArea ? circle!.radiusM : null,
    boundary: isArea ? simplifyBoundary(item.geojson) : null,
    source: "openstreetmap",
  };
}

const UA = "FullTransparency/0.1 (self-hosted location transparency site)";

export async function geocode(q: string, fetchImpl: typeof fetch = fetch): Promise<GeocodeResult[]> {
  const query = q.trim();
  const kind = classifyQuery(query);
  const timeout = AbortSignal.timeout(10_000);

  if (kind === "postcode" || kind === "outcode") {
    const path = kind === "postcode" ? "postcodes" : "outcodes";
    const res = await fetchImpl(`https://api.postcodes.io/${path}/${encodeURIComponent(query.replace(/\s+/g, ""))}`, { signal: timeout });
    if (res.ok) {
      const body = (await res.json()) as { result?: Record<string, unknown> };
      const r = body.result;
      if (r && typeof r.latitude === "number" && typeof r.longitude === "number") {
        const area = [r.admin_ward, r.admin_district].flat().filter(Boolean).join(", ");
        const code = String(r.postcode ?? r.outcode ?? query.toUpperCase());
        return [
          {
            label: area ? `${code} (${area})` : code,
            name: code,
            lat: r.latitude,
            lng: r.longitude,
            kind: "postcode",
            enclosingRadiusM: null,
            source: "postcodes.io",
          },
        ];
      }
    }
    // Fall through to Nominatim (e.g. Crown Dependency postcodes).
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("polygon_threshold", "0.001");
  url.searchParams.set("countrycodes", "gb,im,je,gg");
  const items = await nominatim(url, fetchImpl, timeout);

  // Administrative boundaries (e.g. of an island) include territorial sea.
  // If the land mass exists as a separate "island" feature, offer it first so
  // the circle is centred on, and sized to, the land itself.
  const top = items[0];
  if (top && (top.category ?? top.class) === "boundary" && !items.some((i) => i.type === "island")) {
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim: max 1 request/second
    url.searchParams.set("q", `${query} island`);
    // Only the island of the same name as the search, never other islands
    // inside the searched place (searching "Scotland" must not return Jura).
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const islands = (await nominatim(url, fetchImpl, AbortSignal.timeout(10_000))).filter(
      (i) => i.type === "island" && norm(i.name || i.display_name.split(",")[0]) === norm(query),
    );
    return [...islands, ...items].map(fromNominatim);
  }
  return items.map(fromNominatim);
}

async function nominatim(url: URL, fetchImpl: typeof fetch, signal: AbortSignal): Promise<NominatimItem[]> {
  const res = await fetchImpl(url, { headers: { "user-agent": UA, "accept-language": "en-GB" }, signal });
  if (!res.ok) throw new Error(`Address search failed (HTTP ${res.status})`);
  return (await res.json()) as NominatimItem[];
}

interface NominatimReverse {
  name?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
}

/** "Hathersage, Hathersage" -> "Hathersage": join non-empty parts, skipping repeats. */
const joinUnique = (parts: (string | null | undefined)[]): string | null => {
  const out: string[] = [];
  for (const p of parts) if (p && !out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
  return out.length ? out.join(", ") : null;
};

/** Categories whose name is a public place (a pub, shop, park), never a home. */
const NAMED_PLACE = /^(amenity|shop|tourism|leisure|historic|railway|aeroway|natural|man_made|office|craft|sport)$/;

/**
 * A short public label for a stay: the place's name if it is a named public
 * place, otherwise the street and district. House numbers are never used.
 * Pure: exported for tests.
 */
export function reverseLabelFrom(r: NominatimReverse): string | null {
  const a = r.address ?? {};
  const district = a.suburb ?? a.village ?? a.town ?? a.city_district ?? a.city ?? a.hamlet ?? a.county ?? null;
  const town = a.town ?? a.city ?? a.village ?? null;
  if (r.name && r.category && NAMED_PLACE.test(r.category)) {
    return joinUnique([r.name, town ?? district]);
  }
  const road = a.road ?? a.pedestrian ?? a.footway ?? a.path ?? null;
  return joinUnique([road, district]);
}

/** Reverse-geocode a stay to a short label (server-side; ≤1 request/second is the caller's job). */
export async function reverseLabel(lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lng.toFixed(6));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": UA, "accept-language": "en-GB" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return reverseLabelFrom((await res.json()) as NominatimReverse);
  } catch {
    return null;
  }
}
