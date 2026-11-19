import { describe, expect, it } from "vitest";
import { circleRing, destination } from "@/lib/geo";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";
import { zoneAt, type ZoneArea } from "@/lib/geofence/tiers";
import { ALL_TIME_FROM, historyRange, quickRanges, routesShown } from "@/lib/history-range";
import { atHome, homeAreaFeatures } from "@/lib/home-area";

const sheffield = { lat: 53.38, lng: -1.47 };
const circle = (c: { lat: number; lng: number }, r: number): AreaGeometry => ({ type: "Polygon", coordinates: [circleRing(c, r, 64)] });

describe("a watcher's own areas come before my noted areas", () => {
  const noted = [circle(sheffield, 2000)];
  it("their Wish area wins over my noted area", () => {
    const wish: ZoneArea = { tier: "wide", mode: "inside", geometry: circle(sheffield, 20_000) };
    expect(zoneAt(sheffield, null, [wish], noted)).toBe("amber");
  });
  it("my noted area still shows where none of theirs applies", () => {
    const far: ZoneArea = { tier: "local", mode: null, geometry: circle(destination(sheffield, 0, 50_000), 2000) };
    expect(zoneAt(sheffield, null, [far], noted)).toBe("red");
  });
  it("an area set after a point doesn't colour it", () => {
    const want: ZoneArea = { tier: "local", mode: null, geometry: circle(sheffield, 2000), from: Date.parse("2026-11-18T20:00:00Z") };
    const okay = { ...sheffield, radiusM: 100 };
    expect(zoneAt(destination(sheffield, 90, 500), okay, [want], [], Date.parse("2026-11-18T13:08:00Z"))).toBe("yellow");
    expect(zoneAt(destination(sheffield, 90, 500), okay, [want], [], Date.parse("2026-11-19T13:08:00Z"))).toBe("red");
  });
});

describe("quick date ranges", () => {
  it("Today, Yesterday, This week, This month, This year, All time", () => {
    const r = quickRanges("2026-11-19"); // a Thursday
    expect(r.map((x) => x.label)).toEqual(["Today", "Yesterday", "This week", "This month", "This year", "All time"]);
    expect(r.find((x) => x.key === "week")!.from).toBe("2026-11-16");
    expect(r.find((x) => x.key === "month")!.from).toBe("2026-11-01");
    expect(r.find((x) => x.key === "year")!.from).toBe("2026-01-01");
    expect(r.find((x) => x.key === "all")!.from).toBe(ALL_TIME_FROM);
  });
  it("long ranges show stays only; any range is allowed", () => {
    expect(routesShown("2026-11-01", "2026-11-19")).toBe(true);
    expect(routesShown("2026-01-01", "2026-11-19")).toBe(false);
    expect(historyRange({ from: "2019-01-01", to: "2026-11-19" }).from).toBe("2019-01-01");
  });
});

describe("home area on maps", () => {
  const home = { ...sheffield, radius_m: 427 };
  it("shows the area, and a large marker only when I'm in it", () => {
    expect(homeAreaFeatures(home)).toHaveLength(1);
    expect(homeAreaFeatures(home)[0].properties.dashed).toBe(true);
    const here = homeAreaFeatures(home, { here: true });
    expect(here).toHaveLength(2);
    expect(here[1].properties.size).toBeGreaterThanOrEqual(14);
    expect(homeAreaFeatures(null)).toEqual([]);
  });
  it("in the home area = a current status with no public position", () => {
    expect(atHome("green", null)).toBe(true);
    expect(atHome("green", 53.4)).toBe(false);
    expect(atHome("unknown", null)).toBe(false);
    expect(atHome("disabled", null)).toBe(false);
  });
});

describe("area visits: watched and not watched", () => {
  it("added, removed, added again: since / not tracked / watched / prior", async () => {
    const { coverageSections, sectionIndex } = await import("@/lib/area-visits");
    const s = coverageSections([
      { from: "2026-11-18T20:00:00Z", until: "2026-11-20T10:00:00Z" },
      { from: "2026-11-22T09:00:00Z", until: null },
    ]);
    expect(s.map((x) => x.kind)).toEqual(["since", "gap", "watched", "prior"]);
    expect(s[sectionIndex(s, "2026-11-23T12:00:00Z")].kind).toBe("since");
    expect(s[sectionIndex(s, "2026-11-21T12:00:00Z")].kind).toBe("gap");
    expect(s[sectionIndex(s, "2026-11-19T12:00:00Z")].kind).toBe("watched");
    expect(s[sectionIndex(s, "2026-11-18T13:08:00Z")].kind).toBe("prior");
  });
  it("a redraw (one ends as the next starts) is one watched stretch", async () => {
    const { coverageSections } = await import("@/lib/area-visits");
    const s = coverageSections([
      { from: "2026-11-18T20:00:00Z", until: "2026-11-20T10:00:00Z" },
      { from: "2026-11-20T10:00:00Z", until: null },
    ]);
    expect(s.map((x) => x.kind)).toEqual(["since", "prior"]);
  });
});
