import { describe, expect, it } from "vitest";
import { classify, DEFAULT_HYSTERESIS, nextState, type GeofenceRuntimeState } from "@/lib/geofence/hysteresis";
import { GeofenceValidationError, looksAutomated, normaliseGeofence, geofenceSubmissionSchema } from "@/lib/geofence/submission";
import { DEFAULT_SUBMISSION_BOUNDS } from "@/lib/geo";

const outside: GeofenceRuntimeState = { inside: false, pendingInside: null, pendingCount: 0 };

function run(readings: [number, number | null][], start = outside) {
  let s = start;
  const transitions: string[] = [];
  for (const [d, acc] of readings) {
    const r = nextState(s, { signedDistanceM: d, accuracyM: acc });
    s = r.state;
    if (r.transition) transitions.push(r.transition);
  }
  return { state: s, transitions };
}

describe("geofence hysteresis", () => {
  it("requires consecutive confident readings to enter", () => {
    expect(run([[100, 10]]).transitions).toEqual([]);
    expect(run([[100, 10], [100, 10]]).transitions).toEqual(["enter"]);
  });

  it("does not alert on jitter around the boundary", () => {
    const jitter: [number, number | null][] = Array.from({ length: 50 }, (_, i) => [i % 2 ? 8 : -8, 10]);
    expect(run(jitter).transitions).toEqual([]);
  });

  it("does not alert when a single inside reading is followed by an outside one", () => {
    expect(run([[100, 10], [-100, 10], [100, 10], [-100, 10]]).transitions).toEqual([]);
  });

  it("ignores readings whose accuracy is worse than the threshold", () => {
    expect(classify({ signedDistanceM: 5000, accuracyM: 1000 }, DEFAULT_HYSTERESIS)).toBe("unusable");
    expect(run([[5000, 1000], [5000, 1000], [5000, 1000]]).transitions).toEqual([]);
  });

  it("widens the margin with poor accuracy", () => {
    // margin = 15 + 0.5*accuracy
    expect(classify({ signedDistanceM: 40, accuracyM: 10 }, DEFAULT_HYSTERESIS)).toBe("inside");
    expect(classify({ signedDistanceM: 40, accuracyM: 100 }, DEFAULT_HYSTERESIS)).toBe("ambiguous");
  });

  it("produces a clean enter then exit sequence", () => {
    const r = run([[-200, 10], [50, 10], [60, 10], [70, 10], [-200, 10], [-300, 10]]);
    expect(r.transitions).toEqual(["enter", "exit"]);
    expect(r.state.inside).toBe(false);
  });

  it("ambiguous readings neither confirm nor cancel a pending transition", () => {
    expect(run([[100, 10], [0, 10], [100, 10]]).transitions).toEqual(["enter"]);
  });
});

describe("geofence submission validation", () => {
  const ok = { lat: 53.48, lng: -2.24 };

  it("builds a closed circle polygon", () => {
    const g = normaliseGeofence({ type: "circle", center: ok, radius_m: 200 }, DEFAULT_SUBMISSION_BOUNDS);
    expect(g.ring[0]).toEqual(g.ring.at(-1));
    expect(g.areaM2).toBeGreaterThan(Math.PI * 200 * 200 * 0.97);
    expect(g.areaM2).toBeLessThan(Math.PI * 200 * 200 * 1.01);
    expect(JSON.parse(g.geojson).type).toBe("Polygon");
  });

  it("rejects areas outside the supported region", () => {
    expect(() => normaliseGeofence({ type: "circle", center: { lat: 40.7, lng: -74 }, radius_m: 200 }, DEFAULT_SUBMISSION_BOUNDS)).toThrow(GeofenceValidationError);
  });

  it("rejects self-intersecting polygons", () => {
    const bowtie = [
      { lat: 53.48, lng: -2.25 },
      { lat: 53.49, lng: -2.24 },
      { lat: 53.48, lng: -2.24 },
      { lat: 53.49, lng: -2.25 },
    ];
    expect(() => normaliseGeofence({ type: "polygon", vertices: bowtie }, DEFAULT_SUBMISSION_BOUNDS)).toThrow(/cross/);
  });

  it("rejects polygons beyond any sensible area (over 5,000,000 km²)", () => {
    const huge = [
      { lat: 40.0, lng: -30.0 },
      { lat: 40.0, lng: 30.0 },
      { lat: 70.0, lng: 30.0 },
      { lat: 70.0, lng: -30.0 },
    ];
    expect(() => normaliseGeofence({ type: "polygon", vertices: huge }, DEFAULT_SUBMISSION_BOUNDS)).toThrow(/too large/);
  });

  it("accepts an island-sized circle (~25 km radius)", () => {
    const g = normaliseGeofence({ type: "circle", center: { lat: 54.236, lng: -4.551 }, radius_m: 24_979 }, DEFAULT_SUBMISSION_BOUNDS);
    expect(g.areaM2).toBeGreaterThan(1.9e9);
  });

  it("schema enforces radius limits and empty honeypot", () => {
    expect(geofenceSubmissionSchema.safeParse({ shape: { type: "circle", center: ok, radius_m: 5 }, form_started_at: 1 }).success).toBe(false);
    expect(geofenceSubmissionSchema.safeParse({ shape: { type: "circle", center: ok, radius_m: 100 }, website: "x", form_started_at: 1 }).success).toBe(false);
    expect(geofenceSubmissionSchema.safeParse({ shape: { type: "circle", center: ok, radius_m: 100 }, form_started_at: 1 }).success).toBe(true);
  });

  it("flags bot-like submissions", () => {
    const now = 1_000_000;
    expect(looksAutomated(now - 500, "", now)).toBe(true);
    expect(looksAutomated(now - 10_000, "spam", now)).toBe(true);
    expect(looksAutomated(now - 10_000, "", now)).toBe(false);
  });
});
