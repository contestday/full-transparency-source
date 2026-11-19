// Watch area tiers (owner decisions, 18 Nov 2026). Pure; shared by server and browser.
//
//   wide     "Wish"      amber   somewhere the watcher would rather I didn't go (or leave).
//                                 I'm told about it; it's a wish, not a promise.
//   local    "Want"      red     somewhere the watcher asks me not to go. I'm told about it.
//   location "Location"  purple  a private warning for the watcher only (a home, work,
//                                 a venue), blurred; never shown to me.
// Each area counts only from when it was set (and never before 18 Nov 2026 20:00 GMT).

import { destination, haversineMeters, type LatLng } from "@/lib/geo";
import { areasDisjoint, areaWithin, pointInArea, type AreaGeometry } from "@/lib/geofence/area-geometry";

export type Tier = "wide" | "local" | "location";
export type WideMode = "inside" | "outside";

export const MILE_M = 1609.344;
export const SQ_MILE_M2 = MILE_M * MILE_M;

export const TIER_RULES = {
  /** A drawn wide circle: at least 7.5 miles radius (drawn shapes: the same area). */
  wideMinRadiusM: Math.round(7.5 * MILE_M),
  wideMinShapeM2: Math.PI * (7.5 * MILE_M) ** 2,
  /** A named place (town or larger) counts as wide from 10 square miles. */
  wideMinPlaceM2: 10 * SQ_MILE_M2,
  /**
   * Local circles: at least 1.5 km radius. A circle is centred on a point, likely
   * near the watcher; drawn shapes and named places have no true centre, so they
   * have no minimum. Local areas needn't be inside a wide area.
   */
  localMinRadiusM: 1_500,
  localMinM2: Math.PI * 1_500 ** 2,
  /** Every Location inside a Want circle is at least this far in from its edge (the circle grows to fit). */
  localEdgeBufferM: 250,
  /** A grown circle gets up to this much extra at random, so its size doesn't give away where a Location is. */
  localGrowJitterM: 250,
  /** Locations: any size, from a single building to a 50-mile radius (never shown to me); the stored circle is double. */
  locationMinRadiusM: 25,
  locationMaxRadiusM: Math.round(50 * MILE_M),
  /** "Anywhere beyond home" circles are shifted off-centre by up to this. */
  beyondHomeMaxShiftM: 1_000,
} as const;

export const TIER_META: Record<Tier, { label: string; short: string; color: string; description: string }> = {
  wide: {
    label: "Wish",
    short: "Wish",
    color: "#F08C00",
    description: "A large area, such as a county or city, that you'd rather I didn't go into (or didn't leave). I'm told about it, but it's a wish: I can't promise.",
  },
  local: {
    label: "Want",
    short: "Want",
    color: "#C62828",
    description: "A smaller area, such as a town or district, that you're asking me not to go into. I'm told about it.",
  },
  location: {
    label: "Location",
    short: "Location",
    color: "#7E22CE",
    description: "A private warning for you only: a place such as a home, workplace or venue. It's blurred, and I'm never shown it.",
  },
};

/** Smallest allowed area for a wide-sized area (also used for anything not inside a wide area). */
export function wideMinimumM2(isNamedPlace: boolean): number {
  return isNamedPlace ? TIER_RULES.wideMinPlaceM2 : TIER_RULES.wideMinShapeM2;
}

export function fmtSqMiles(m2: number): string {
  const mi = m2 / SQ_MILE_M2;
  return `${mi >= 10 ? Math.round(mi).toLocaleString("en-GB") : mi.toFixed(1)} sq miles`;
}

/** A watcher's existing area, as needed for the size and nesting rules. */
export interface TierContextArea {
  id: string;
  tier: Tier;
  mode: WideMode | null;
  /** Null for "beyond home" (its circle is never revealed or checked). */
  geometry: AreaGeometry | null;
  /** Location only: the watcher's real point. */
  point?: LatLng | null;
  /** Want circles only: the circle as drawn. */
  circle?: { center: LatLng; radius_m: number } | null;
}

/** Is `g` (or point `p`) within the given wide area (inside its "amber" part)? */
function withinWide(wide: TierContextArea, g: AreaGeometry | null, p: LatLng | null): boolean {
  // Beyond-home areas count as containing everything: checking would reveal home.
  if (!wide.geometry) return true;
  if (wide.mode === "outside") return p ? !pointInArea(p, wide.geometry) : g ? areasDisjoint(g, wide.geometry) : false;
  return p ? pointInArea(p, wide.geometry) : g ? areaWithin(g, wide.geometry) : false;
}

export function insideAnyWide(others: TierContextArea[], g: AreaGeometry | null, p: LatLng | null = null): boolean {
  return others.some((o) => o.tier === "wide" && withinWide(o, g, p));
}

export class TierRuleError extends Error {}

/**
 * Size and nesting rules for a wide or local area. `others` excludes the area
 * being edited. Throws TierRuleError with a message for the watcher.
 */
export function checkAreaRules(input: {
  tier: "wide" | "local";
  geometry: AreaGeometry;
  areaM2: number;
  isNamedPlace: boolean;
  /** A drawn circle (defaults to anything that isn't a named place). */
  isCircle?: boolean;
  others: TierContextArea[];
}): void {
  const { tier, geometry, areaM2, isNamedPlace, others } = input;
  const isCircle = input.isCircle ?? !isNamedPlace;
  const wideMin = wideMinimumM2(isNamedPlace);
  if (tier === "wide") {
    // Never one Wish area inside another (either way round).
    for (const o of others) {
      if (o.tier !== "wide" || !o.geometry) continue;
      if (areaWithin(geometry, o.geometry) || areaWithin(o.geometry, geometry)) {
        throw new TierRuleError("A Wish area can't be inside another Wish area (or contain one). Make it a Want area instead, or change the other area.");
      }
    }
    if (areaM2 < wideMin) {
      throw new TierRuleError(
        isNamedPlace
          ? `A Wish area must be a town or larger (at least ${fmtSqMiles(wideMin)}). Use a Want area for somewhere smaller.`
          : `A Wish area must be at least a 7.5-mile radius circle (${fmtSqMiles(wideMin)}). Search a named place such as a county or city, or use a Want area.`,
      );
    }
    return;
  }
  // A Want area stands on its own: it can be inside a Wish area, overlap one, or have none.
  // Only circles have a minimum (a drawn circle is stored as a many-sided shape, a fraction smaller).
  if (isCircle && areaM2 < TIER_RULES.localMinM2 * 0.995) {
    throw new TierRuleError("A Want circle must have a radius of at least 1.5 km. Make it bigger, or draw a shape or search a named place instead.");
  }
  for (const o of others) {
    if (o.tier !== "local" || !o.geometry) continue;
    if (areaWithin(geometry, o.geometry) || areaWithin(o.geometry, geometry)) {
      throw new TierRuleError("A Want area can't be inside another Want area (or contain one). Add it as a Location instead, or change the other area.");
    }
  }
}

/**
 * The radius a Want circle needs so that every Location inside it is at least
 * 250 m in from its edge. Growing can bring another Location inside, so it
 * repeats until none is too close. Each growth adds up to 250 m at random
 * (`rnd` gives numbers in [0, 1)), rounded up to 10 m.
 */
export function grownLocalRadius(center: LatLng, radiusM: number, points: LatLng[], rnd: () => number): number {
  const buffer = TIER_RULES.localEdgeBufferM;
  let r = radiusM;
  for (let pass = 0; pass < 50; pass++) {
    const tooClose = points.map((p) => haversineMeters(center, p)).filter((d) => d < r && d + buffer > r);
    if (!tooClose.length) break;
    const need = Math.max(...tooClose) + buffer;
    r = Math.ceil((need + rnd() * TIER_RULES.localGrowJitterM) / 10) * 10;
  }
  return r;
}

/**
 * Want circles that must grow because a Location at `point` is inside them
 * and less than 250 m from the edge (with every other Location kept 250 m in).
 */
export function wantCirclesToGrow(point: LatLng, others: TierContextArea[], rnd: () => number): { id: string; radius_m: number }[] {
  const points = [point, ...others.filter((o) => o.tier === "location" && o.point).map((o) => o.point!)];
  const out: { id: string; radius_m: number }[] = [];
  for (const o of others) {
    if (o.tier !== "local" || !o.circle) continue;
    const d = haversineMeters(o.circle.center, point);
    if (d >= o.circle.radius_m || d + TIER_RULES.localEdgeBufferM <= o.circle.radius_m) continue;
    out.push({ id: o.id, radius_m: grownLocalRadius(o.circle.center, o.circle.radius_m, points, rnd) });
  }
  return out;
}

/** Uniform random point in a disk, from two random numbers in [0, 1). */
export function randomOffset(center: LatLng, maxM: number, u1: number, u2: number): LatLng {
  if (maxM <= 0) return { lat: center.lat, lng: center.lng };
  return destination(center, u1 * 360, Math.sqrt(u2) * maxM);
}

/**
 * Blur a location: the stored circle is twice the watcher's radius, placed
 * at random so that the watcher's own circle always lies inside it. A
 * Location stands on its own: it needn't be inside a Wish or Want area.
 */
export function blurLocation(point: LatLng, radiusM: number, u1: number, u2: number): { center: LatLng; radiusM: number } {
  const big = 2 * radiusM;
  const center = randomOffset(point, big - radiusM, u1, u2);
  return { center, radiusM: big };
}

/** Off-centre "beyond home" circle centre: home shifted by up to a third of the distance, max 1 km. */
export function shiftedHome(home: LatLng, distanceM: number, u1: number, u2: number): LatLng {
  return randomOffset(home, Math.min(TIER_RULES.beyondHomeMaxShiftM, distanceM / 3), u1, u2);
}

/* -------------------------------------------------------- route colours */

/** Route/zone colours, strongest first. */
export type Zone = "purple" | "red" | "amber" | "yellow" | "green";
export const ZONE_COLOR: Record<Zone, string> = {
  purple: TIER_META.location.color,
  red: TIER_META.local.color,
  amber: TIER_META.wide.color,
  yellow: "#D4A900",
  green: "#007B60",
};
export const ZONE_LABEL: Record<Zone, string> = {
  purple: "At one of your locations",
  red: "In one of your Want areas, or one of my noted areas",
  amber: "In one of your Wish areas",
  yellow: "Outside my okay zone",
  green: "Within my okay zone",
};

/** An area evaluated for colouring (wide "outside" areas count when outside them). */
export interface ZoneArea {
  tier: Tier;
  mode: WideMode | null;
  geometry: AreaGeometry;
  /** When it came into effect (ms). Points from before then are not coloured by it. */
  from?: number;
}

/** What everyone sees: red in one of my own (admin) areas, else green / yellow by the okay zone. */
export type BaseZone = "green" | "yellow" | "red";
export type WatchZone = "purple" | "red" | "amber";

export const BASE_ZONE_LABEL: Record<BaseZone, string> = {
  green: "Within my okay zone",
  yellow: "Outside my okay zone",
  red: "In one of my noted areas",
};
export const WATCH_ZONE_LABEL: Record<WatchZone, string> = {
  purple: "At one of your locations",
  red: "In one of your Want areas",
  amber: "In one of your Wish areas",
};

export function baseZoneAt(p: LatLng, okayZone: (LatLng & { radiusM: number }) | null, ownAreas: readonly AreaGeometry[] = []): BaseZone {
  if (ownAreas.some((g) => pointInArea(p, g))) return "red";
  if (!okayZone) return "green";
  return haversineMeters(p, okayZone) <= okayZone.radiusM ? "green" : "yellow";
}

/** The strongest of a watcher's own areas at p, or null. */
export function watchZoneAt(p: LatLng, areas: readonly ZoneArea[], at?: number): WatchZone | null {
  const z = zoneAt(p, null, areas, [], at);
  return z === "purple" || z === "red" || z === "amber" ? z : null;
}

/** Colour of one point for one watcher (or the public, with no areas). */
export function zoneAt(
  p: LatLng,
  okayZone: (LatLng & { radiusM: number }) | null,
  allAreas: readonly ZoneArea[],
  ownAreas: readonly AreaGeometry[] = [],
  /** The time of the point (ms): areas set after it don't count. Omit for "now". */
  at?: number,
): Zone {
  const areas = at == null ? allAreas : allAreas.filter((a) => a.from == null || a.from <= at);
  // A watcher's own areas come first; my noted areas are context only, used where none of theirs applies.
  let best: Zone | null = null;
  for (const a of areas) {
    const inside = pointInArea(p, a.geometry);
    const hit = a.tier === "wide" && a.mode === "outside" ? !inside : inside;
    if (!hit) continue;
    const z: Zone = a.tier === "location" ? "purple" : a.tier === "local" ? "red" : "amber";
    if (z === "purple") return z;
    if (!best || (z === "red" && best === "amber")) best = z;
  }
  if (best) return best;
  if (ownAreas.some((g) => pointInArea(p, g))) return "red";
  if (!okayZone) return "green";
  return haversineMeters(p, okayZone) <= okayZone.radiusM ? "green" : "yellow";
}

/**
 * Is an edit only a rename? True when the kind, direction and shape are all
 * unchanged (the name or note may differ). Anything else is a redraw, which
 * makes a new area from now. Pure.
 */
export function sameArea(
  current: { tier: Tier; mode: WideMode | null; kind: "shape" | "beyond_home" | "location"; shape: unknown; distance_m: number | null },
  tier: Tier,
  mode: WideMode | null,
  shape: unknown,
): boolean {
  if (current.tier !== tier) return false;
  const s = shape as { type?: string; distance_m?: number };
  if (current.kind === "beyond_home") return s.type === "beyond_home" && s.distance_m === current.distance_m && (mode ?? "outside") === "outside";
  if (s.type === "beyond_home") return false;
  if ((current.mode ?? null) !== (tier === "wide" ? (mode ?? "inside") : null)) return false;
  return JSON.stringify(current.shape) === JSON.stringify(shape);
}
