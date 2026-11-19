import { describe, expect, it } from "vitest";
import { defaultModeForVenue, isPublished, planInputSchema, publicLocationFor, publicStopFor, recurrenceStarts, venuePrecisionError, windowPlans } from "@/lib/plans";
import { incidentTimestamp, reportSchema, sniffMime } from "@/lib/reports";
import { containsCoordinates } from "@/lib/notify";
import { makeReference } from "@/lib/crypto";

const base = {
  title: "Dinner",
  category: "restaurant",
  starts_at: "2026-12-01T19:00:00.000Z",
  status: "planned",
  publication_mode: "exact_venue",
};

describe("plan validation", () => {
  it("accepts a normal plan", () => {
    expect(planInputSchema.safeParse(base).success).toBe(true);
  });
  it("requires confirmation to publish a sensitive category at venue precision", () => {
    // Hotels follow the venue rule (public venues in full), so no extra confirmation.
    expect(planInputSchema.safeParse({ ...base, category: "accommodation" }).success).toBe(true);
    expect(planInputSchema.safeParse({ ...base, category: "healthcare" }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...base, category: "healthcare", confirm_sensitive_exact: true }).success).toBe(true);
    expect(planInputSchema.safeParse({ ...base, category: "travel", publication_mode: "general_area" }).success).toBe(true);
  });
  it("rejects an end before the start", () => {
    expect(planInputSchema.safeParse({ ...base, ends_at: "2026-11-30T00:00:00.000Z" }).success).toBe(false);
  });
  it("requires lat and lng together", () => {
    expect(planInputSchema.safeParse({ ...base, lat: 51 }).success).toBe(false);
  });
});

describe("venue privacy rule", () => {
  it("public venues may be shown in full", () => {
    expect(venuePrecisionError("exact_venue", { is_public: true }, false, false)).toBeNull();
    expect(defaultModeForVenue({ is_public: true })).toBe("exact_venue");
  });
  it("private addresses are area-only unless explicitly confirmed", () => {
    expect(venuePrecisionError("exact_venue", { is_public: false }, false, false)).toMatch(/private address/);
    expect(venuePrecisionError("retrospective", { is_public: false }, false, false)).toMatch(/private address/);
    expect(venuePrecisionError("general_area", { is_public: false }, false, false)).toBeNull();
    expect(venuePrecisionError("exact_venue", { is_public: false }, false, true)).toBeNull();
    expect(defaultModeForVenue({ is_public: false })).toBe("general_area");
    expect(defaultModeForVenue(null)).toBe("general_area");
  });
  it("a custom pinned location counts as private", () => {
    expect(venuePrecisionError("exact_venue", null, true, false)).toMatch(/private address/);
  });
});

describe("plan publication projection", () => {
  const loc = { lat: 53.4801, lng: -2.2421 };
  it("private plans expose nothing", () => {
    expect(publicLocationFor("private", loc)).toEqual({ public_lat: null, public_lng: null, public_cell_size_m: null });
  });
  it("general-area plans expose only a 2 km cell centre", () => {
    const p = publicLocationFor("general_area", loc);
    expect(p.public_cell_size_m).toBe(2000);
    expect(p.public_lat).not.toBe(loc.lat);
  });
  it("exact plans expose the venue", () => {
    expect(publicLocationFor("exact_venue", loc)).toMatchObject({ public_lat: loc.lat, public_lng: loc.lng });
  });
  it("drafts and private plans are not published", () => {
    expect(isPublished("draft", "exact_venue")).toBe(false);
    expect(isPublished("planned", "private")).toBe(false);
    expect(isPublished("cancelled", "general_area")).toBe(true);
  });
});

describe("reports", () => {
  it("validates a minimal anonymous report", () => {
    const r = reportSchema.parse({ category: "question", description: "Something happened here today", form_started_at: "123" });
    expect(r.contact_info).toBeNull();
    expect(r.incident_date).toBeNull();
  });
  it("rejects malformed geofence references", () => {
    expect(reportSchema.safeParse({ category: "other", description: "Something happened", related_geofence_reference: "abc", form_started_at: 1 }).success).toBe(false);
    expect(reportSchema.parse({ category: "other", description: "Something happened", related_geofence_reference: "ft-g-abcd-efgh", form_started_at: 1 }).related_geofence_reference).toBe("FT-G-ABCD-EFGH");
  });
  it("detects file types by content, not extension", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(new TextEncoder().encode("<html><script>"))).toBeNull();
  });
  it("builds incident timestamps", () => {
    expect(incidentTimestamp("2026-11-01", "14:30")).toBe("2026-11-01T14:30:00.000Z");
    expect(incidentTimestamp(null, "14:30")).toBeNull();
  });
  it("generates well-formed references", () => {
    expect(makeReference("R")).toMatch(/^FT-R-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});

describe("notification safety", () => {
  it("detects coordinate pairs in notification text", () => {
    expect(containsCoordinates("Entered area at 53.48012, -2.24210")).toBe(true);
    expect(containsCoordinates("Reference FT-G-ABCD-EFGH at Tue, 17 Nov 2026 10:00:00 GMT")).toBe(false);
  });
});

describe("additional plan locations", () => {
  const pub = { name: "The Crown", is_public: true, lat: 53.48, lng: -2.24, public_area_label: "Central Manchester" };
  const priv = { name: "Mum's", is_public: false, lat: 53.38, lng: -1.47, public_area_label: "Mill Lane" };
  it("shows public venues in full when the plan shows venues", () => {
    expect(publicStopFor("exact_venue", pub)).toMatchObject({ public_venue_name: "The Crown", public_lat: 53.48, public_cell_size_m: null });
  });
  it("never shows a private address beyond its area, whatever the mode", () => {
    for (const mode of ["exact_venue", "retrospective", "general_area"] as const) {
      const s = publicStopFor(mode, priv);
      expect(s.public_venue_name).toBeNull();
      expect(s.public_cell_size_m).toBe(2000);
      expect(s.public_area_label).toBe("Mill Lane");
    }
  });
  it("general-area plans hide even public venue names", () => {
    expect(publicStopFor("general_area", pub).public_venue_name).toBeNull();
  });
  it("private plans expose nothing", () => {
    expect(publicStopFor("private", pub)).toMatchObject({ public_venue_name: null, public_lat: null });
  });
});

describe("recurrence", () => {
  it("weekly and fortnightly", () => {
    expect(recurrenceStarts("2026-12-01T19:00:00.000Z", "weekly", 2)).toEqual(["2026-12-08T19:00:00.000Z", "2026-12-15T19:00:00.000Z"]);
    expect(recurrenceStarts("2026-12-01T19:00:00.000Z", "fortnightly", 1)).toEqual(["2026-12-15T19:00:00.000Z"]);
  });
  it("monthly clamps to the end of shorter months", () => {
    expect(recurrenceStarts("2027-01-31T10:00:00.000Z", "monthly", 2)).toEqual(["2027-02-28T10:00:00.000Z", "2027-03-31T10:00:00.000Z"]);
  });
});

describe("windowPlans (a week at a time)", () => {
  const day = (iso: string) => iso.slice(0, 10);
  const mk = (start: string, end: string | null = null) => ({ starts_at: `${start}T10:00:00Z`, ends_at: end ? `${end}T10:00:00Z` : null });
  const plans = [mk("2026-11-10"), mk("2026-11-15", "2026-11-18"), mk("2026-11-17"), mk("2026-11-23"), mk("2026-11-24"), mk("2026-12-13")];

  it("shows the next 7 days, including plans already under way", () => {
    const w = windowPlans(plans, "2026-11-17", 7, "upcoming", day);
    expect(w.shown.map((p) => p.starts_at.slice(0, 10))).toEqual(["2026-11-15", "2026-11-17", "2026-11-23"]);
    expect(w.beyond).toHaveLength(2);
    expect(w.boundary).toBe("2026-11-24");
  });
  it("show more extends by another week", () => {
    expect(windowPlans(plans, "2026-11-17", 14, "upcoming", day).shown).toHaveLength(4);
  });
  it("with the time, a plan that has finished today moves to past", () => {
    const today = [
      { starts_at: "2026-11-17T08:00:00Z", ends_at: "2026-11-17T09:00:00Z" },
      { starts_at: "2026-11-17T20:30:00Z", ends_at: null },
    ];
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(windowPlans(today, "2026-11-17", 7, "upcoming", day, now).shown.map((p) => p.starts_at.slice(11, 16))).toEqual(["20:30"]);
    expect(windowPlans(today, "2026-11-17", 7, "past", day, now).shown.map((p) => p.starts_at.slice(11, 16))).toEqual(["08:00"]);
  });
  it("past plans go back a week at a time", () => {
    const w = windowPlans(plans, "2026-11-17", 7, "past", day);
    expect(w.shown.map((p) => p.starts_at.slice(0, 10))).toEqual(["2026-11-10"]);
    expect(w.beyond).toHaveLength(0);
  });
});

describe("exact publication (grid 0)", async () => {
  const { buildPolicy, decide } = await import("@/lib/publication");
  const rules = [
    { rule_type: "pause", configuration: {}, enabled: false },
    { rule_type: "delay", configuration: { hours: 0 }, enabled: true },
    { rule_type: "grid", configuration: { meters: 0 }, enabled: true },
    { rule_type: "exclusion_zone", configuration: { lat: 53.38, lng: -1.47, radius_m: 250, label: "Home" }, enabled: true },
  ];
  const policy = buildPolicy(rules);

  it("publishes the recorded position and minute-precision times", () => {
    expect(policy.gridM).toBe(0);
    const d = decide({ key: "visit:1", kind: "visit", lat: 54.1523456, lng: -4.4812345, observedAt: "2024-09-28T19:07:41Z", observedUntil: "2024-09-28T21:52:10Z" }, policy, Date.parse("2026-11-18T00:00:00Z"));
    expect(d.publish).toBe(true);
    if (!d.publish) return;
    expect(d.record.cell_size_m).toBe(0);
    expect(d.record.public_lat).toBeCloseTo(54.152346, 6);
    expect(d.record.observed_at).toBe("2024-09-28T19:07:00.000Z");
    expect(d.record.observed_until).toBe("2024-09-28T21:52:00.000Z");
  });

  it("still never publishes inside the home zone", () => {
    const d = decide({ key: "track:1", kind: "track", lat: 53.3801, lng: -1.4701, observedAt: "2024-09-28T19:00:00Z" }, policy, Date.parse("2026-11-18T00:00:00Z"));
    expect(d.publish).toBe(false);
  });
});

describe("place labels", async () => {
  const { reverseLabelFrom } = await import("@/lib/geocode");
  it("uses a public place's name, else street and district, never a house number", () => {
    expect(reverseLabelFrom({ name: "Rovers Return", category: "amenity", address: { road: "Coronation Street", town: "Douglas", house_number: "1" } })).toBe("Rovers Return, Douglas");
    const home = reverseLabelFrom({ name: "", category: "building", address: { house_number: "14", road: "Example Road", suburb: "Crookes" } });
    expect(home).toBe("Example Road, Crookes");
    expect(home).not.toContain("14");
  });
});

describe("place labels never repeat a name", async () => {
  const { reverseLabelFrom } = await import("@/lib/geocode");
  it("Hathersage, Hathersage -> Hathersage", () => {
    expect(reverseLabelFrom({ address: { village: "Hathersage", suburb: "Hathersage" } })).toBe("Hathersage");
  });
});

describe("planListOrder", async () => {
  const { planListOrder } = await import("@/lib/plans");
  const { londonDayKey } = await import("@/lib/format");
  const p = (iso: string) => ({ starts_at: iso });
  it("upcoming: date order, then time order within the date", () => {
    const items = [p("2026-11-21T09:00:00Z"), p("2026-11-20T20:30:00Z"), p("2026-11-20T10:00:00Z")];
    expect(planListOrder(items, londonDayKey, "upcoming").map((x) => x.starts_at.slice(5, 16))).toEqual(["11-20T10:00", "11-20T20:30", "11-21T09:00"]);
  });
});

describe("latestFirstWithinDay", async () => {
  const { latestFirstWithinDay } = await import("@/lib/plans");
  const { londonDayKey } = await import("@/lib/format");
  const p = (iso: string) => ({ starts_at: iso });
  const items = [p("2026-11-20T11:00:00Z"), p("2026-11-20T23:00:00Z"), p("2026-11-21T09:00:00Z"), p("2026-11-20T15:00:00Z")];

  it("upcoming: soonest day first, latest time first within it", () => {
    expect(latestFirstWithinDay(items, londonDayKey, "ascending").map((x) => x.starts_at.slice(5, 13))).toEqual([
      "11-20T23", "11-20T15", "11-20T11", "11-21T09",
    ]);
  });
  it("past: latest day first, latest time first within it", () => {
    expect(latestFirstWithinDay(items, londonDayKey, "descending").map((x) => x.starts_at.slice(5, 13))).toEqual([
      "11-21T09", "11-20T23", "11-20T15", "11-20T11",
    ]);
  });
});
