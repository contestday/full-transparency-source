// Point-in-area, distance and containment for GeoJSON areas, in plain
// TypeScript (used for sealed watcher areas, which PostGIS never sees). Pure.

import { ringAreaM2, type LatLng } from "@/lib/geo";

export type Ring = [number, number][]; // [lng, lat], closed
export type AreaGeometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };

const polygonsOf = (g: AreaGeometry): Ring[][] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInArea(p: LatLng, g: AreaGeometry): boolean {
  return polygonsOf(g).some((poly) => pointInRing(p.lng, p.lat, poly[0]) && !poly.slice(1).some((h) => pointInRing(p.lng, p.lat, h)));
}

const M_PER_DEG = 111_320;

/** Distance in metres from p to the nearest edge (local flat projection: fine for alerts). */
export function distanceToEdgeM(p: LatLng, g: AreaGeometry): number {
  const kx = M_PER_DEG * Math.cos((p.lat * Math.PI) / 180);
  let best = Infinity;
  for (const poly of polygonsOf(g)) {
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - p.lng) * kx;
        const ay = (ring[i - 1][1] - p.lat) * M_PER_DEG;
        const bx = (ring[i][0] - p.lng) * kx;
        const by = (ring[i][1] - p.lat) * M_PER_DEG;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/** Positive inside (distance to the edge), negative outside. */
export function signedDistanceM(p: LatLng, g: AreaGeometry): number {
  const d = distanceToEdgeM(p, g);
  return pointInArea(p, g) ? d : -d;
}

export function areaM2(g: AreaGeometry): number {
  return polygonsOf(g).reduce((s, poly) => s + ringAreaM2(poly[0]) - poly.slice(1).reduce((h, r) => h + ringAreaM2(r), 0), 0);
}

function vertices(g: AreaGeometry): LatLng[] {
  return polygonsOf(g).flatMap((poly) => poly[0].map(([lng, lat]) => ({ lat, lng })));
}

/** Every outer vertex of `inner` lies in `outer` (close enough for these size rules). */
export function areaWithin(inner: AreaGeometry, outer: AreaGeometry): boolean {
  return vertices(inner).every((v) => pointInArea(v, outer));
}

/** No vertex of either area lies in the other. */
export function areasDisjoint(a: AreaGeometry, b: AreaGeometry): boolean {
  return !vertices(a).some((v) => pointInArea(v, b)) && !vertices(b).some((v) => pointInArea(v, a));
}
