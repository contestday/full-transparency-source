import { describe, expect, it } from "vitest";
import { computeLiveStatus, computeWatcherStatus, homeSignedDistance, isOnTheMove, publicMarkerPosition, type MovementReading } from "@/lib/live-status";
import { destination } from "@/lib/geo";

const none = new Set<string>();

describe("computeLiveStatus", () => {
  const base = { stale: false, insideFenceIds: none, homeInside: true as boolean | null };

  it("green inside the okay zone, yellow outside", () => {
    expect(computeLiveStatus(base)).toBe("green");
    expect(computeLiveStatus({ ...base, homeInside: false })).toBe("yellow");
  });

  it("amber inside any wide area, regardless of the okay zone", () => {
    expect(computeLiveStatus({ ...base, insideFenceIds: new Set(["a"]) })).toBe("amber");
    expect(computeLiveStatus({ ...base, homeInside: false, insideFenceIds: new Set(["a"]) })).toBe("amber");
  });

  it("unknown when stale or the home range is not configured", () => {
    expect(computeLiveStatus({ ...base, stale: true, insideFenceIds: new Set(["a"]) })).toBe("unknown");
    expect(computeLiveStatus({ ...base, homeInside: null })).toBe("unknown");
  });
});

describe("home range distance", () => {
  const home = { lat: 53.38, lng: -1.47, radiusM: 4828 };
  it("is positive inside and negative outside", () => {
    expect(homeSignedDistance(destination(home, 90, 1000), home)).toBeCloseTo(3828, -1);
    expect(homeSignedDistance(destination(home, 90, 6000), home)).toBeCloseTo(-1172, -1);
  });
});

describe("publicMarkerPosition", () => {
  const p = { lat: 53.5, lng: -1.2 };
  const far = { lat: 51.5, lng: -0.1, radiusM: 250, label: "Home" };
  it("shows no position at all until a hidden zone exists", () => {
    expect(publicMarkerPosition("yellow", p, 1000, [])).toBeNull();
  });
  it("shows movement inside the okay zone (green) but hides it when stale", () => {
    expect(publicMarkerPosition("green", p, 1000, [far])).not.toBeNull();
    expect(publicMarkerPosition("unknown", p, 1000, [])).toBeNull();
  });
  it("hides the hidden zone around home plus half a square, and no more", () => {
    const home = { lat: 53.38, lng: -1.47, radiusM: 250, label: "Home" };
    // ~150 m from home: hidden
    expect(publicMarkerPosition("green", { lat: 53.3813, lng: -1.47 }, 250, [home])).toBeNull();
    // ~1 km from home with 250 m squares: shown
    expect(publicMarkerPosition("green", { lat: 53.389, lng: -1.47 }, 250, [home])).not.toBeNull();
  });
  it("returns a generalised cell centre otherwise", () => {
    const c = publicMarkerPosition("yellow", p, 1000, [far]);
    expect(c).not.toBeNull();
    expect(c!.cellM).toBe(1000);
    expect(c!.lat).not.toBe(p.lat);
  });
  it("hides the position near an exclusion zone", () => {
    expect(publicMarkerPosition("red", p, 1000, [{ lat: 53.503, lng: -1.2, radiusM: 200, label: "x" }])).toBeNull();
  });
});

describe("computeWatcherStatus", () => {
  it("my own areas win; otherwise the okay-zone colour", () => {
    expect(computeWatcherStatus({ stale: false, homeStatus: "yellow", areaZone: null })).toBe("yellow");
    expect(computeWatcherStatus({ stale: false, homeStatus: "green", areaZone: "red" })).toBe("red");
    expect(computeWatcherStatus({ stale: false, homeStatus: "green", areaZone: "purple" })).toBe("purple");
  });
  it("unknown when stale", () => {
    expect(computeWatcherStatus({ stale: true, homeStatus: "green", areaZone: "amber" })).toBe("unknown");
  });
});

describe("isOnTheMove", () => {
  const now = Date.parse("2026-11-17T20:30:00Z");
  const at = (minAgo: number, lat: number, extra: Partial<MovementReading> = {}): MovementReading => ({
    observed_at: new Date(now - minAgo * 60_000).toISOString(),
    lat,
    lng: -1.5,
    accuracy_m: 10,
    ...extra,
  });
  it("is moving when recent readings are clearly apart", () => {
    expect(isOnTheMove([at(1, 53.385), at(4, 53.38)], now)).toBe(true); // ~550 m in 3 min
  });
  it("is moving when the device reports speed", () => {
    expect(isOnTheMove([at(1, 53.38, { speed_kmh: 5 })], now)).toBe(true);
  });
  it("is not moving when stationary, jittering or stale", () => {
    expect(isOnTheMove([at(1, 53.38), at(4, 53.3801)], now)).toBe(false); // ~11 m: GPS noise
    expect(isOnTheMove([at(20, 53.39), at(23, 53.38)], now)).toBe(false); // too old
    expect(isOnTheMove([at(1, 53.38)], now)).toBe(false);
    expect(isOnTheMove([], now)).toBe(false);
  });
});
