// Pure geographic helpers (no I/O). Safe for client and server.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    // Null Island is almost always a device error
    !(lat === 0 && lng === 0)
  );
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Destination point given start, bearing (deg) and distance (m). */
export function destination(start: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(start.lat);
  const λ1 = toRad(start.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/** Closed ring of [lng, lat] approximating a circle. */
export function circleRing(center: LatLng, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const p = destination(center, (360 / steps) * i, radiusM);
    ring.push([round6(p.lng), round6(p.lat)]);
  }
  ring.push(ring[0]);
  return ring;
}

/** Approximate area (m²) of a ring of [lng, lat] on a sphere. */
export function ringAreaM2(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/** True if any two non-adjacent edges of a closed ring intersect. */
export function ringSelfIntersects(ring: [number, number][]): boolean {
  const n = ring.length - 1;
  const segs = (i: number) => [ring[i], ring[(i + 1) % n]] as const;
  const orient = (a: number[], b: number[], c: number[]) =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const [p1, p2] = segs(i);
      const [p3, p4] = segs(j);
      if (
        orient(p1, p2, p3) * orient(p1, p2, p4) < 0 &&
        orient(p3, p4, p1) * orient(p3, p4, p2) < 0
      ) {
        return true;
      }
    }
  }
  return false;
}

export function ringCentroid(ring: [number, number][]): LatLng {
  const pts = ring.slice(0, -1);
  const lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { lat, lng };
}

/**
 * Snap a coordinate to the centre of an approximately square grid cell of the
 * given size. The cell is defined in degrees at the cell's latitude band so the
 * output is stable for all points in the same cell (important: generalised
 * output must not leak the precise position through jitter).
 */
export function snapToGrid(p: LatLng, cellM: number): LatLng & { cellM: number } {
  const latStep = cellM / 111_320;
  const latIndex = Math.floor(p.lat / latStep);
  const cellLat = (latIndex + 0.5) * latStep;
  const lngStep = cellM / (111_320 * Math.max(0.01, Math.cos(toRad(cellLat))));
  const lngIndex = Math.floor(p.lng / lngStep);
  return {
    lat: round6(cellLat),
    lng: round6((lngIndex + 0.5) * lngStep),
    cellM,
  };
}

/** GeoJSON polygon for a grid cell centred on p (for display). */
export function gridCellRing(center: LatLng, cellM: number): [number, number][] {
  const latHalf = cellM / 111_320 / 2;
  const lngHalf = cellM / (111_320 * Math.max(0.01, Math.cos(toRad(center.lat)))) / 2;
  return [
    [center.lng - lngHalf, center.lat - latHalf],
    [center.lng + lngHalf, center.lat - latHalf],
    [center.lng + lngHalf, center.lat + latHalf],
    [center.lng - lngHalf, center.lat + latHalf],
    [center.lng - lngHalf, center.lat - latHalf],
  ];
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Default submission bounds: Great Britain, Northern Ireland, Channel Islands. */
export const DEFAULT_SUBMISSION_BOUNDS: Bounds = {
  minLat: 49.0,
  maxLat: 61.0,
  minLng: -8.7,
  maxLng: 2.0,
};

export function withinBounds(p: LatLng, b: Bounds): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

export function parseBounds(raw: string | undefined): Bounds {
  if (!raw) return DEFAULT_SUBMISSION_BOUNDS;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return DEFAULT_SUBMISSION_BOUNDS;
  const [minLat, minLng, maxLat, maxLng] = parts;
  return { minLat, minLng, maxLat, maxLng };
}
