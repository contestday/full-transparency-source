import { describe, expect, it } from "vitest";
import { circleRing, destination, haversineMeters } from "@/lib/geo";
import { areaM2, areaWithin, pointInArea, signedDistanceM, type AreaGeometry } from "@/lib/geofence/area-geometry";
import { sameArea, blurLocation, checkAreaRules, grownLocalRadius, wantCirclesToGrow, MILE_M, shiftedHome, SQ_MILE_M2, TierRuleError, zoneAt, type TierContextArea } from "@/lib/geofence/tiers";
import { colouredRouteSegments } from "@/lib/route";

const sheffield = { lat: 53.38, lng: -1.47 };
const circle = (c: { lat: number; lng: number }, r: number): AreaGeometry => ({ type: "Polygon", coordinates: [circleRing(c, r, 64)] });

describe("area geometry", () => {
  const g = circle(sheffield, 1000);
  it("point in area and signed distance", () => {
    expect(pointInArea(sheffield, g)).toBe(true);
    expect(pointInArea(destination(sheffield, 0, 1500), g)).toBe(false);
    expect(signedDistanceM(destination(sheffield, 90, 800), g)).toBeGreaterThan(150);
    expect(signedDistanceM(destination(sheffield, 90, 1300), g)).toBeLessThan(-250);
  });
  it("area and containment", () => {
    expect(areaM2(g)).toBeCloseTo(Math.PI * 1e6, -5);
    expect(areaWithin(circle(sheffield, 300), g)).toBe(true);
    expect(areaWithin(circle(destination(sheffield, 0, 900), 300), g)).toBe(false);
  });
});

describe("tier rules", () => {
  const wide: TierContextArea = { id: "w", tier: "wide", mode: "inside", geometry: circle(sheffield, 20 * MILE_M) };
  it("wide circles need a 7.5-mile radius; named places 10 sq miles", () => {
    const small = circle(sheffield, 5 * MILE_M);
    expect(() => checkAreaRules({ tier: "wide", geometry: small, areaM2: areaM2(small), isNamedPlace: false, others: [] })).toThrow(TierRuleError);
    expect(() => checkAreaRules({ tier: "wide", geometry: small, areaM2: areaM2(small), isNamedPlace: true, others: [] })).not.toThrow();
    const big = circle(sheffield, 7.6 * MILE_M);
    expect(() => checkAreaRules({ tier: "wide", geometry: big, areaM2: areaM2(big), isNamedPlace: false, others: [] })).not.toThrow();
  });
  it("local areas: a 1.5 km circle, with or without a Wish area around it", () => {
    const local = circle(sheffield, 1500);
    expect(areaM2(local) / SQ_MILE_M2).toBeGreaterThan(2.7);
    expect(() => checkAreaRules({ tier: "local", geometry: local, areaM2: areaM2(local), isNamedPlace: false, others: [wide] })).not.toThrow();
    expect(() => checkAreaRules({ tier: "local", geometry: local, areaM2: areaM2(local), isNamedPlace: false, others: [] })).not.toThrow();
    // Across the edge of a Wish area is fine too.
    const across = circle(destination(sheffield, 90, 20 * MILE_M), 1500);
    expect(() => checkAreaRules({ tier: "local", geometry: across, areaM2: areaM2(across), isNamedPlace: false, others: [wide] })).not.toThrow();
    const small = circle(sheffield, 1400);
    expect(() => checkAreaRules({ tier: "local", geometry: small, areaM2: areaM2(small), isNamedPlace: false, others: [wide] })).toThrow(/1.5 km/);
    // Drawn shapes and named places have no true centre, so no minimum.
    expect(() => checkAreaRules({ tier: "local", geometry: small, areaM2: areaM2(small), isNamedPlace: false, isCircle: false, others: [] })).not.toThrow();
    expect(() => checkAreaRules({ tier: "local", geometry: small, areaM2: areaM2(small), isNamedPlace: true, others: [] })).not.toThrow();
  });
  it("a local area can't sit inside another local area", () => {
    const outer: TierContextArea = { id: "l", tier: "local", mode: null, geometry: circle(sheffield, 3 * MILE_M) };
    const inner = circle(sheffield, 1.1 * MILE_M);
    expect(() => checkAreaRules({ tier: "local", geometry: inner, areaM2: areaM2(inner), isNamedPlace: false, others: [wide, outer] })).toThrow(/another Want area/);
  });
  it("a Wish area can't sit inside another Wish area", () => {
    const inner = circle(sheffield, 10 * MILE_M);
    expect(() => checkAreaRules({ tier: "wide", geometry: inner, areaM2: areaM2(inner), isNamedPlace: false, others: [wide] })).toThrow(/another Wish area/);
  });
  it("beyond-home wide areas count as containing everything (no probing of home)", () => {
    const beyond: TierContextArea = { id: "b", tier: "wide", mode: "outside", geometry: null };
    const local = circle(sheffield, 1.1 * MILE_M);
    expect(() => checkAreaRules({ tier: "local", geometry: local, areaM2: areaM2(local), isNamedPlace: false, others: [beyond] })).not.toThrow();
  });
});

describe("Want circles keep Locations 250 m from the edge", () => {
  const at = (m: number, bearing = 90) => destination(sheffield, bearing, m);
  it("leaves the circle alone when every Location is 250 m or more inside", () => {
    expect(grownLocalRadius(sheffield, 1000, [at(700), at(100, 0)], () => 0.5)).toBe(1000);
    // A Location outside the circle isn't nested, so it doesn't count.
    expect(grownLocalRadius(sheffield, 1000, [at(1100)], () => 0.5)).toBe(1000);
  });
  it("grows so a Location near the edge ends up at least 250 m inside", () => {
    const p = at(900);
    const r = grownLocalRadius(sheffield, 1000, [p], () => 0);
    expect(r).toBeGreaterThanOrEqual(haversineMeters(sheffield, p) + 250);
    expect(r).toBeLessThan(1200);
    const jittered = grownLocalRadius(sheffield, 1000, [p], () => 0.999);
    expect(jittered).toBeLessThanOrEqual(1410);
  });
  it("keeps growing when growth brings another Location in", () => {
    const pts = [at(900), at(1100, 180)]; // the second is outside 1 km, but inside once it grows to fit the first
    const r = grownLocalRadius(sheffield, 1000, pts, () => 0);
    for (const p of pts) expect(r - haversineMeters(sheffield, p)).toBeGreaterThanOrEqual(250);
  });
  it("a new Location near the edge of a Want circle grows that circle", () => {
    const want: TierContextArea = { id: "l", tier: "local", mode: null, geometry: circle(sheffield, 1000), circle: { center: sheffield, radius_m: 1000 } };
    expect(wantCirclesToGrow(at(500), [want], () => 0)).toEqual([]);
    const g = wantCirclesToGrow(at(850), [want], () => 0);
    expect(g).toHaveLength(1);
    expect(g[0].radius_m).toBeGreaterThanOrEqual(1100);
  });
});

describe("location blur", () => {
  it("doubles the radius, keeps the real circle inside, never centres on the point", () => {
    for (let i = 0; i < 50; i++) {
      const b = blurLocation(sheffield, 250, Math.random(), Math.random());
      expect(b.radiusM).toBe(500);
      expect(haversineMeters(b.center, sheffield) + 250).toBeLessThanOrEqual(500 + 1);
    }
  });
  it("stays twice the radius when it isn't inside any Wish or Want area", () => {
    expect(blurLocation(sheffield, 300, 0.3, 0.7).radiusM).toBe(600);
  });
  it("beyond-home circles move by at most 1 km", () => {
    for (let i = 0; i < 20; i++) expect(haversineMeters(shiftedHome(sheffield, 10_000, Math.random(), Math.random()), sheffield)).toBeLessThanOrEqual(1000.5);
  });
});

describe("zone colours", () => {
  const okay = { ...sheffield, radiusM: 2 * MILE_M };
  const hospital = destination(sheffield, 270, 2000);
  const areas = [
    { tier: "wide" as const, mode: "outside" as const, geometry: circle(sheffield, 10 * MILE_M) },
    { tier: "local" as const, mode: null, geometry: circle(destination(sheffield, 270, 2500), 1500) },
    { tier: "location" as const, mode: null, geometry: circle(hospital, 400) },
  ];
  it("strongest wins: purple > red > amber > yellow > green", () => {
    expect(zoneAt(sheffield, okay, [])).toBe("green");
    expect(zoneAt(destination(sheffield, 0, 5000), okay, [])).toBe("yellow");
    expect(zoneAt(hospital, okay, areas)).toBe("purple");
    expect(zoneAt(destination(sheffield, 270, 3500), okay, areas)).toBe("red");
    expect(zoneAt(destination(sheffield, 0, 12 * MILE_M), okay, areas)).toBe("amber");
    expect(zoneAt(destination(sheffield, 90, 5000), okay, areas)).toBe("yellow");
  });
  it("an area only counts from when it was set (the dated record)", () => {
    const set = Date.parse("2026-11-18T20:00:00Z");
    const timed = [{ tier: "location" as const, mode: null, geometry: circle(hospital, 400), from: set }];
    expect(zoneAt(hospital, okay, timed, [], set - 60_000)).not.toBe("purple"); // before it was set
    expect(zoneAt(hospital, okay, timed, [], set + 60_000)).toBe("purple");
    expect(zoneAt(hospital, okay, timed)).toBe("purple"); // now
  });
  it("route lines change colour without gaps", () => {
    const t0 = Date.parse("2026-11-18T10:00:00Z");
    const pts = [0, 1000, 2000, 3000, 4000].map((d, i) => {
      const p = destination(sheffield, 0, d);
      return { observed_at: new Date(t0 + i * 180_000).toISOString(), public_lat: p.lat, public_lng: p.lng };
    });
    const segs = colouredRouteSegments(pts, (p) => zoneAt(p, { ...sheffield, radiusM: 2500 }, []));
    expect(segs.map((s) => s.zone)).toEqual(["green", "yellow"]);
    expect(segs[1].coords[0]).toEqual(segs[0].coords.at(-1));
  });
});

describe("rename or redraw", () => {
  const circleShape = { type: "circle", center: { lat: 53.38, lng: -1.47 }, radius_m: 2000 };
  const wish = { tier: "wide" as const, mode: "inside" as const, kind: "shape" as const, shape: circleShape, distance_m: null };
  it("same shape, kind and direction is a rename", () => {
    expect(sameArea(wish, "wide", "inside", { ...circleShape })).toBe(true);
  });
  it("a bigger circle, another kind or the other direction is a redraw", () => {
    expect(sameArea(wish, "wide", "inside", { ...circleShape, radius_m: 2500 })).toBe(false);
    expect(sameArea(wish, "local", null, circleShape)).toBe(false);
    expect(sameArea(wish, "wide", "outside", circleShape)).toBe(false);
  });
  it("beyond-home: only a new distance is a redraw", () => {
    const b = { tier: "wide" as const, mode: "outside" as const, kind: "beyond_home" as const, shape: null, distance_m: 3219 };
    expect(sameArea(b, "wide", "outside", { type: "beyond_home", distance_m: 3219 })).toBe(true);
    expect(sameArea(b, "wide", "outside", { type: "beyond_home", distance_m: 8047 })).toBe(false);
  });
});

describe("alert wording", async () => {
  const { alertText } = await import("@/lib/alert-text");
  const base = { ownerName: "Test Person", ownerFirst: "Test", tier: "local", outside: false, areaName: "Nether Green", reference: "FT-G-X", sample: false };
  it("says why, what and where in plain words", () => {
    const t = alertText({ ...base, event: "enter" });
    expect(t.title).toBe("Test may be in your Want: Nether Green");
    expect(t.body).toContain("asked to be notified of Test Person's movements");
    expect(t.body).toContain("marked as Want, named “Nether Green”");
  });
  it("still-there and left read correctly; 'didn't leave' Wish areas are reversed", () => {
    expect(alertText({ ...base, event: "still", since: "2026-11-18T20:08:00Z" }).body).toContain("still in a place you marked as Want");
    expect(alertText({ ...base, event: "exit" }).title).toContain("may have left");
    expect(alertText({ ...base, tier: "wide", outside: true, event: "enter" }).title).toContain("may have left your Wish");
  });
  it("sample alerts say so loudly", () => {
    const t = alertText({ ...base, sample: true, event: "enter" });
    expect(t.title.startsWith("SAMPLE ALERT")).toBe(true);
    expect(t.body).toContain("NOT YOUR OWN WATCH LIST");
  });
});
