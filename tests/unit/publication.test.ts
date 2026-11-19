import { describe, expect, it } from "vitest";
import { buildPolicy, coarsenTime, decide, type Candidate, type PublicationRuleRow } from "@/lib/publication";
import { detectVisits, type ObsPoint } from "@/lib/visits";
import { haversineMeters, snapToGrid } from "@/lib/geo";

const HOME = { lat: 53.8, lng: -1.55 };
const baseRules: PublicationRuleRow[] = [
  { rule_type: "pause", configuration: {}, enabled: false },
  { rule_type: "delay", configuration: { hours: 24 }, enabled: true },
  { rule_type: "grid", configuration: { meters: 1000 }, enabled: true },
  { rule_type: "exclusion_zone", configuration: { ...HOME, radius_m: 500, label: "Home" }, enabled: true },
  { rule_type: "excluded_category", configuration: { category: "healthcare" }, enabled: true },
  { rule_type: "area_label", configuration: { lat: 53.48, lng: -2.24, radius_m: 3000, label: "Central Manchester" }, enabled: true },
];
const NOW = Date.parse("2026-11-17T12:00:00Z");
const old = "2026-11-10T10:07:00Z";

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  key: "visit:1",
  kind: "visit",
  lat: 53.4801,
  lng: -2.2421,
  observedAt: old,
  observedUntil: "2026-11-10T11:52:00Z",
  ...over,
});

describe("publication policy", () => {
  it("treats a missing pause rule as paused (fail safe)", () => {
    expect(buildPolicy(baseRules.filter((r) => r.rule_type !== "pause")).paused).toBe(true);
    expect(buildPolicy(baseRules).paused).toBe(false);
  });

  it("enforces a minimum grid size", () => {
    expect(buildPolicy([...baseRules.filter((r) => r.rule_type !== "grid"), { rule_type: "grid", configuration: { meters: 10 }, enabled: true }]).gridM).toBe(250);
  });

  it("publishes generalised, delayed, coarsened records", () => {
    const d = decide(cand(), buildPolicy(baseRules), NOW);
    expect(d.publish).toBe(true);
    if (!d.publish) return;
    expect(d.record.area_label).toBe("Central Manchester");
    expect(d.record.observed_at).toBe("2026-11-10T10:00:00.000Z");
    expect(d.record.cell_size_m).toBe(1000);
    // generalised position is the cell centre, not the raw point
    const raw = { lat: 53.4801, lng: -2.2421 };
    expect(d.record.public_lat).not.toBe(raw.lat);
    expect(haversineMeters(raw, { lat: d.record.public_lat, lng: d.record.public_lng })).toBeLessThan(800);
  });

  it("is stable: nearby points in the same cell publish identical coordinates", () => {
    const a = snapToGrid({ lat: 53.4801, lng: -2.2421 }, 1000);
    const b = snapToGrid({ lat: 53.4802, lng: -2.2422 }, 1000);
    expect(a).toEqual(b);
  });

  it("refuses while paused", () => {
    const rules = baseRules.map((r) => (r.rule_type === "pause" ? { ...r, enabled: true } : r));
    expect(decide(cand(), buildPolicy(rules), NOW)).toEqual({ publish: false, reason: "paused" });
  });

  it("refuses until at least one exclusion zone exists", () => {
    expect(decide(cand(), buildPolicy(baseRules.filter((r) => r.rule_type !== "exclusion_zone")), NOW)).toEqual({ publish: false, reason: "no_exclusion_zones" });
  });

  it("honours the delay", () => {
    const recent = new Date(NOW - 3600_000).toISOString();
    expect(decide(cand({ observedAt: recent, observedUntil: recent }), buildPolicy(baseRules), NOW)).toEqual({ publish: false, reason: "delay" });
  });

  it("never publishes inside an exclusion zone", () => {
    expect(decide(cand({ lat: HOME.lat + 0.001, lng: HOME.lng }), buildPolicy(baseRules), NOW)).toEqual({ publish: false, reason: "exclusion_zone" });
  });

  it("never publishes a cell that overlaps an exclusion zone, even if the point is outside it", () => {
    // ~700 m from home: outside the 500 m zone, but its 1 km cell may contain home
    const p = { lat: HOME.lat + 0.0063, lng: HOME.lng };
    expect(haversineMeters(p, HOME)).toBeGreaterThan(500);
    expect(decide(cand(p), buildPolicy(baseRules), NOW)).toEqual({ publish: false, reason: "exclusion_zone" });
  });

  it("publishes a public venue in full (name + exact position)", () => {
    const pub = { lat: 53.4805, lng: -2.2425, name: "The Crown" };
    const d = decide(cand({ publicVenue: pub }), buildPolicy(baseRules), NOW);
    expect(d.publish).toBe(true);
    if (!d.publish) return;
    expect(d.record).toMatchObject({ venue_name: "The Crown", public_lat: pub.lat, public_lng: pub.lng, cell_size_m: 0 });
  });

  it("never publishes a public venue inside an exclusion zone", () => {
    const pub = { lat: HOME.lat + 0.001, lng: HOME.lng, name: "Local" };
    expect(decide(cand({ ...pub, publicVenue: pub }), buildPolicy(baseRules), NOW)).toEqual({ publish: false, reason: "exclusion_zone" });
  });

  it("still applies excluded categories to public venues", () => {
    const pub = { lat: 53.48, lng: -2.24, name: "Hospital" };
    expect(decide(cand({ publicVenue: pub, category: "healthcare" }), buildPolicy(baseRules), NOW)).toEqual({ publish: false, reason: "category" });
  });

  it("private places never carry a venue name", () => {
    const d = decide(cand(), buildPolicy(baseRules), NOW);
    expect(d.publish && d.record.venue_name).toBe(null);
  });

  it("excludes configured categories", () => {
    expect(decide(cand({ category: "healthcare" }), buildPolicy(baseRules), NOW)).toEqual({ publish: false, reason: "category" });
  });

  it("coarsens time to 15 minutes", () => {
    expect(coarsenTime("2026-01-01T10:14:59Z")).toBe("2026-01-01T10:00:00.000Z");
    expect(coarsenTime("2026-01-01T10:15:00Z")).toBe("2026-01-01T10:15:00.000Z");
  });
});

describe("visit detection", () => {
  const t0 = Date.parse("2026-11-10T09:00:00Z");
  const at = (min: number, lat: number, lng: number, acc: number | null = 10): ObsPoint => ({ t: t0 + min * 60_000, lat, lng, accuracyM: acc });

  it("detects a stay of 10+ minutes and ignores pass-through points", () => {
    const pts = [
      at(0, 53.0, -2.0),
      at(5, 53.01, -2.0), // moving
      at(10, 53.48, -2.24),
      at(15, 53.4801, -2.2401),
      at(25, 53.4802, -2.2399),
      at(40, 53.48, -2.24),
      at(45, 53.6, -2.3), // left
    ];
    const v = detectVisits(pts);
    expect(v).toHaveLength(1);
    expect(v[0].startedAt).toBe(t0 + 10 * 60_000);
    expect(v[0].endedAt).toBe(t0 + 40 * 60_000);
    expect(v[0].count).toBe(4);
  });

  it("ignores very inaccurate points", () => {
    expect(detectVisits([at(0, 53.48, -2.24, 900), at(30, 53.48, -2.24, 900)])).toEqual([]);
  });

  it("keeps one stay across a long silence in the same place (no movement reported)", () => {
    expect(detectVisits([at(0, 53.48, -2.24), at(60 * 7, 53.48, -2.24)])).toHaveLength(1);
  });
});
