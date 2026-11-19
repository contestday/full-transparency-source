// Simplify OpenStreetMap place outlines (towns, counties, islands, countries)
// into something small enough to store and test against: Douglas-Peucker per
// ring, tiny islets dropped, total vertices capped. Pure.

import { ringAreaM2 } from "@/lib/geo";

export type Ring = [number, number][]; // [lng, lat], closed
export type MultiPolygonCoords = Ring[][]; // polygons → rings (outer first, then holes)

export const MAX_BOUNDARY_VERTICES = 2000;
export const MAX_BOUNDARY_PARTS = 60;

function perpDistSq(p: [number, number], a: [number, number], b: [number, number]): number {
  // Planar in degrees with longitude scaled by latitude: fine at this tolerance.
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const [px, py, ax, ay, bx, by] = [p[0] * k, p[1], a[0] * k, a[1], b[0] * k, b[1]];
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/** Douglas-Peucker on a closed ring; keeps it closed with at least 4 positions, else returns null. */
export function simplifyRing(ring: Ring, tolDeg: number): Ring | null {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring.slice();
  if (pts.length < 3) return null;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  // Split at the point furthest from the first so a closed ring simplifies well.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > farD) [far, farD] = [i, d];
  }
  keep[far] = 1;
  const tolSq = tolDeg * tolDeg;
  const stack: [number, number][] = [
    [0, far],
    [far, pts.length],
  ];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const end = pts[e % pts.length];
    let idx = -1;
    let max = tolSq;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistSq(pts[i], pts[s], end);
      if (d > max) [idx, max] = [i, d];
    }
    if (idx !== -1) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = pts.filter((_, i) => keep[i]);
  if (out.length < 3) return null;
  out.push([out[0][0], out[0][1]]);
  return out;
}

function toMulti(geojson: { type: string; coordinates: unknown }): MultiPolygonCoords | null {
  if (geojson.type === "Polygon") return [geojson.coordinates as Ring[]];
  if (geojson.type === "MultiPolygon") return geojson.coordinates as Ring[][];
  return null;
}

const vertexCount = (m: MultiPolygonCoords) => m.reduce((n, poly) => n + poly.reduce((k, r) => k + r.length - 1, 0), 0);

/**
 * Simplify a Polygon/MultiPolygon outline to at most `maxVertices` vertices:
 * the largest parts are kept (islets under 0.1% of the total area are
 * dropped), and the tolerance grows until it fits. Returns null if nothing
 * usable remains.
 */
export function simplifyBoundary(
  geojson: { type: string; coordinates: unknown } | null | undefined,
  maxVertices = MAX_BOUNDARY_VERTICES,
): { type: "Polygon" | "MultiPolygon"; coordinates: Ring[] | Ring[][] } | null {
  const multi = geojson ? toMulti(geojson) : null;
  if (!multi?.length) return null;
  const parts = multi
    .filter((poly) => poly[0]?.length >= 4)
    .map((poly) => ({ poly, area: ringAreaM2(poly[0]) }))
    .sort((a, b) => b.area - a.area);
  const total = parts.reduce((s, p) => s + p.area, 0);
  const kept = parts.filter((p, i) => i === 0 || p.area >= total * 0.001).slice(0, MAX_BOUNDARY_PARTS);

  for (let tol = 0.0002; tol < 1; tol *= 1.6) {
    const simplified: MultiPolygonCoords = [];
    for (const { poly } of kept) {
      const outer = simplifyRing(poly[0], tol);
      if (!outer) continue;
      const holes = poly.slice(1).map((h) => simplifyRing(h, tol)).filter((h): h is Ring => h !== null);
      simplified.push([outer, ...holes]);
    }
    if (!simplified.length) return null;
    if (vertexCount(simplified) <= maxVertices) {
      return simplified.length === 1 ? { type: "Polygon", coordinates: simplified[0] } : { type: "MultiPolygon", coordinates: simplified };
    }
  }
  return null;
}
