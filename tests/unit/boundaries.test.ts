import { describe, expect, it } from "vitest";
import { simplifyBoundary, simplifyRing, type Ring } from "@/lib/geo-simplify";
import { geofenceSubmissionSchema, normaliseGeofence, GEOFENCE_LIMITS } from "@/lib/geofence/submission";
import { DEFAULT_SUBMISSION_BOUNDS } from "@/lib/geo";

/** A wiggly closed ring with n points around a centre (a "county"). */
function blob(lng: number, lat: number, rDeg: number, n: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const r = rDeg * (1 + 0.05 * Math.sin(a * 37));
    ring.push([lng + r * Math.cos(a) * 1.7, lat + r * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return ring;
}

describe("simplifyRing", () => {
  it("keeps a valid closed ring and removes redundant points", () => {
    const r = blob(-1.5, 53.5, 0.3, 5000);
    const s = simplifyRing(r, 0.002)!;
    expect(s.length).toBeLessThan(r.length);
    expect(s[0]).toEqual(s.at(-1));
    expect(s.length).toBeGreaterThanOrEqual(4);
  });
});

describe("simplifyBoundary", () => {
  it("caps a detailed county outline at the vertex budget", () => {
    const out = simplifyBoundary({ type: "Polygon", coordinates: [blob(-1.5, 53.5, 0.3, 20_000)] }, 2000)!;
    expect(out.type).toBe("Polygon");
    const n = (out.coordinates as Ring[])[0].length - 1;
    expect(n).toBeLessThanOrEqual(2000);
    expect(n).toBeGreaterThan(50);
  });

  it("keeps islands as a MultiPolygon and drops specks", () => {
    const main = blob(-4.5, 54.2, 0.2, 3000);
    const island = blob(-4.0, 54.6, 0.05, 500);
    const speck = blob(-4.9, 54.0, 0.0005, 20);
    const out = simplifyBoundary({ type: "MultiPolygon", coordinates: [[main], [island], [speck]] })!;
    expect(out.type).toBe("MultiPolygon");
    expect((out.coordinates as Ring[][]).length).toBe(2);
  });

  it("returns null for non-polygons", () => {
    expect(simplifyBoundary({ type: "Point", coordinates: [0, 0] })).toBeNull();
  });
});

describe("boundary submissions", () => {
  const base = { form_started_at: Date.now() - 10_000 };

  it("accepts a large county outline (well over the old 8,000 km² cap)", () => {
    const outline = blob(-1.5, 53.5, 0.8, 4000); // roughly 80 x 180 km
    const input = geofenceSubmissionSchema.parse({ ...base, shape: { type: "boundary", name: "Test county", geojson: { type: "Polygon", coordinates: [outline] } } });
    const g = normaliseGeofence(input.shape, DEFAULT_SUBMISSION_BOUNDS);
    expect(g.areaM2).toBeGreaterThan(8_000_000_000);
    expect(g.areaM2).toBeLessThan(GEOFENCE_LIMITS.maxAreaM2);
    expect(JSON.parse(g.geojson).coordinates[0].length - 1).toBeLessThanOrEqual(2000);
  });

  it("stores a multi-part island outline as a MultiPolygon", () => {
    const geojson = { type: "MultiPolygon", coordinates: [[blob(-4.5, 54.2, 0.2, 800)], [blob(-4.0, 54.6, 0.05, 200)]] };
    const input = geofenceSubmissionSchema.parse({ ...base, shape: { type: "boundary", name: "Isle", geojson } });
    const g = normaliseGeofence(input.shape, DEFAULT_SUBMISSION_BOUNDS);
    expect(JSON.parse(g.geojson).type).toBe("MultiPolygon");
    expect(g.shapeType).toBe("boundary");
  });

  it("rejects malformed outlines and places outside the region", () => {
    const bad = geofenceSubmissionSchema.parse({ ...base, shape: { type: "boundary", geojson: { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] } } });
    expect(() => normaliseGeofence(bad.shape, DEFAULT_SUBMISSION_BOUNDS)).toThrow();
    const paris = geofenceSubmissionSchema.parse({ ...base, shape: { type: "boundary", geojson: { type: "Polygon", coordinates: [blob(2.35, 48.85, 0.1, 100)] } } });
    expect(() => normaliseGeofence(paris.shape, DEFAULT_SUBMISSION_BOUNDS)).toThrow(/outside/);
  });
});

describe("large circles", () => {
  it("a 1,000 km circle centred in the UK is accepted (covers the whole UK)", () => {
    const g = normaliseGeofence({ type: "circle", center: { lat: 54.5, lng: -3 }, radius_m: 1_000_000 }, DEFAULT_SUBMISSION_BOUNDS);
    expect(g.areaM2).toBeGreaterThan(3e12);
  });
  it("a 60 km circle easily covers a 50 km wide island", () => {
    expect(() => normaliseGeofence({ type: "circle", center: { lat: 54.236, lng: -4.551 }, radius_m: 60_000 }, DEFAULT_SUBMISSION_BOUNDS)).not.toThrow();
  });
});
