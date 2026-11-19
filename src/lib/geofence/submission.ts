import { z } from "zod";
import {
  circleRing,
  isValidLatLng,
  ringAreaM2,
  ringCentroid,
  ringSelfIntersects,
  withinBounds,
  type Bounds,
} from "@/lib/geo";
import { TIER_RULES } from "@/lib/geofence/tiers";
import { MAX_BOUNDARY_VERTICES, simplifyBoundary, type Ring } from "@/lib/geo-simplify";

export const GEOFENCE_CATEGORIES = {
  school: "School or childcare",
  home: "Residence",
  workplace: "Workplace",
  healthcare: "Healthcare setting",
  community: "Community or public space",
  other: "Other",
} as const;

export const GEOFENCE_LIMITS = {
  minRadiusM: 25,
  // Circles up to 1,000 km: enough to cover the whole UK from anywhere in it.
  // Named places (towns, counties, islands, countries) use their real outline.
  // Areas must still be centred in the supported region.
  maxRadiusM: 1_000_000,
  minAreaM2: 500,
  maxAreaM2: 5_000_000_000_000, // 5,000,000 km² (a 1,000 km circle is ~3.1 million)
  maxVertices: 50,
  minVertices: 3,
  /** "Anywhere beyond home": at least 1 km, so the area never pinpoints home. */
  minBeyondHomeM: 1_000,
};

const point = z.object({ lat: z.number(), lng: z.number() });

export const geofenceSubmissionSchema = z.object({
  shape: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("circle"),
      center: point,
      radius_m: z.number().min(GEOFENCE_LIMITS.minRadiusM).max(GEOFENCE_LIMITS.maxRadiusM),
    }),
    z.object({
      type: z.literal("polygon"),
      vertices: z.array(point).min(GEOFENCE_LIMITS.minVertices).max(GEOFENCE_LIMITS.maxVertices),
    }),
    // "Anywhere more than distance_m from home" (home itself is never sent or shown).
    z.object({
      type: z.literal("beyond_home"),
      distance_m: z.number().min(GEOFENCE_LIMITS.minBeyondHomeM).max(GEOFENCE_LIMITS.maxRadiusM),
    }),
    // A watcher's location (home, work, a venue): blurred server-side, never stored as given.
    z.object({
      type: z.literal("location"),
      center: point,
      radius_m: z.number().min(TIER_RULES.locationMinRadiusM).max(TIER_RULES.locationMaxRadiusM),
    }),
    // A named place's real outline (from place search), re-simplified server-side.
    z.object({
      type: z.literal("boundary"),
      name: z.string().trim().max(200).optional().default(""),
      geojson: z.object({
        type: z.enum(["Polygon", "MultiPolygon"]),
        coordinates: z.array(z.any()).min(1).max(5000),
      }),
    }),
  ]),
  /** Watch areas: wide (amber), local (red) or location (purple). */
  tier: z.enum(["wide", "local", "location"]).optional(),
  /** Wide areas: "inside" = don't go in; "outside" = don't go outside it. */
  wide_mode: z.enum(["inside", "outside"]).optional(),
  approximate_location: z.string().trim().max(200).optional().default(""),
  description: z.string().trim().max(1000).optional().default(""),
  category: z.enum(Object.keys(GEOFENCE_CATEGORIES) as [string, ...string[]]).optional(),
  // Anti-abuse: honeypot must be empty; form must have been open >= 3 s.
  website: z.string().max(0).optional().default(""),
  form_started_at: z.number().int(),
  /** Existing private watch link token, to add this area to the same watch set. */
  watch_token: z.string().trim().toUpperCase().max(64).optional(),
});

export type GeofenceSubmission = z.infer<typeof geofenceSubmissionSchema>;

export interface NormalisedGeofence {
  /** Stored shape type: outlines are stored as polygons. */
  shapeType: "circle" | "polygon" | "boundary" | "beyond_home";
  ring: [number, number][];
  center: { lat: number; lng: number };
  radiusM: number | null;
  areaM2: number;
  geojson: string;
}

export class GeofenceValidationError extends Error {}

export function normaliseGeofence(
  shape: GeofenceSubmission["shape"],
  bounds: Bounds,
  /** Home (private, server-side only): needed for "beyond home" areas. */
  home?: { lat: number; lng: number } | null,
): NormalisedGeofence {
  let ring: [number, number][];
  let center: { lat: number; lng: number };
  let radiusM: number | null = null;

  if (shape.type === "boundary") return normaliseBoundary(shape.geojson, bounds);
  if (shape.type === "location") throw new GeofenceValidationError("A location can only be added to a watch link");
  if (shape.type === "beyond_home") {
    if (!home) throw new GeofenceValidationError("“Anywhere beyond home” isn't available yet");
    // Stored as the circle around home; evaluated inverted (outside = in the area).
    const r = circleRing(home, shape.distance_m, 128);
    return { shapeType: "beyond_home", ring: r, center: home, radiusM: shape.distance_m, areaM2: ringAreaM2(r), geojson: JSON.stringify({ type: "Polygon", coordinates: [r] }) };
  }

  if (shape.type === "circle") {
    if (!isValidLatLng(shape.center.lat, shape.center.lng)) throw new GeofenceValidationError("Invalid centre point");
    center = shape.center;
    radiusM = shape.radius_m;
    ring = circleRing(center, radiusM);
  } else {
    for (const v of shape.vertices) {
      if (!isValidLatLng(v.lat, v.lng)) throw new GeofenceValidationError("Invalid vertex");
    }
    ring = shape.vertices.map((v) => [v.lng, v.lat] as [number, number]);
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    if (ring.length - 1 < GEOFENCE_LIMITS.minVertices) throw new GeofenceValidationError("Too few vertices");
    if (ringSelfIntersects(ring)) throw new GeofenceValidationError("Polygon edges must not cross");
    center = ringCentroid(ring);
  }

  // The middle of the area must be in the supported region; a large circle
  // may reach beyond it (e.g. out to sea).
  if (!withinBounds(center, bounds)) {
    throw new GeofenceValidationError("Area is outside the supported region");
  }
  const areaM2 = ringAreaM2(ring);
  if (areaM2 < GEOFENCE_LIMITS.minAreaM2) throw new GeofenceValidationError("Area is too small");
  if (areaM2 > GEOFENCE_LIMITS.maxAreaM2) throw new GeofenceValidationError("Area is too large");

  return {
    shapeType: shape.type as "circle" | "polygon",
    ring,
    center,
    radiusM,
    areaM2,
    geojson: JSON.stringify({ type: "Polygon", coordinates: [ring] }),
  };
}

const isPos = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number" && isValidLatLng(p[1], p[0]);

/** A place outline: Polygon or MultiPolygon, checked, re-simplified, area-limited. */
function normaliseBoundary(geojson: { type: "Polygon" | "MultiPolygon"; coordinates: unknown[] }, bounds: Bounds): NormalisedGeofence {
  const polys = (geojson.type === "Polygon" ? [geojson.coordinates] : geojson.coordinates) as unknown[];
  for (const poly of polys) {
    if (!Array.isArray(poly) || !poly.length) throw new GeofenceValidationError("Invalid outline");
    for (const r of poly) {
      if (!Array.isArray(r) || r.length < 4 || !r.every(isPos)) throw new GeofenceValidationError("Invalid outline");
    }
  }
  const simple = simplifyBoundary({ type: geojson.type, coordinates: geojson.coordinates }, MAX_BOUNDARY_VERTICES);
  if (!simple) throw new GeofenceValidationError("Invalid outline");
  const parts = (simple.type === "Polygon" ? [simple.coordinates] : simple.coordinates) as Ring[][];
  const largest = parts.reduce((a, b) => (ringAreaM2(b[0]) > ringAreaM2(a[0]) ? b : a));
  const center = ringCentroid(largest[0]);
  if (!withinBounds(center, bounds)) throw new GeofenceValidationError("Area is outside the supported region");
  const areaM2 = parts.reduce((s, p) => s + ringAreaM2(p[0]) - p.slice(1).reduce((h, r) => h + ringAreaM2(r), 0), 0);
  if (areaM2 < GEOFENCE_LIMITS.minAreaM2) throw new GeofenceValidationError("Area is too small");
  if (areaM2 > GEOFENCE_LIMITS.maxAreaM2) throw new GeofenceValidationError("Area is too large");
  return { shapeType: "boundary", ring: largest[0], center, radiusM: null, areaM2, geojson: JSON.stringify(simple) };
}

export const MIN_FORM_FILL_MS = 3000;

export function looksAutomated(formStartedAt: number, honeypot: string, now = Date.now()): boolean {
  return honeypot !== "" || now - formStartedAt < MIN_FORM_FILL_MS || formStartedAt > now + 60_000;
}
