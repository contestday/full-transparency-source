import { describe, expect, it } from "vitest";
import { checkEventWindow, describeRecurrence, eventDates, eventOnAt, eventPhase, EventRuleError, insidePlace, isOccurrenceDate, londonToUtc, placesInclude, seriesWindow, EVENT_RULES, OPEN_END_DATE, type Recurrence } from "@/lib/events/rules";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";
import { circleRing } from "@/lib/geo";

const H = 3_600_000;
const now = Date.parse("2026-11-21T12:00:00Z");
const venue: AreaGeometry = { type: "Polygon", coordinates: [circleRing({ lat: 53.4, lng: -1.5 }, 500, 64)] };

describe("event times", () => {
  it("needs 48 hours' notice", () => {
    expect(() => checkEventWindow(now + 47 * H, now + 50 * H, now)).toThrow(EventRuleError);
    expect(() => checkEventWindow(now - H, now + H, now)).toThrow(/48 hours/);
    expect(() => checkEventWindow(now + 49 * H, now + 60 * H, now)).not.toThrow();
  });
  it("can be set up to 5 years ahead, and any length", () => {
    expect(() => checkEventWindow(now + 4.9 * 365 * 24 * H, now + 5.8 * 365 * 24 * H, now)).not.toThrow();
    expect(() => checkEventWindow(now + EVENT_RULES.maxAheadMs + H, now + EVENT_RULES.maxAheadMs + 2 * H, now)).toThrow(/5 years/);
  });
  it("must end after it starts", () => {
    expect(() => checkEventWindow(now + 50 * H, now + 50 * H, now)).toThrow(/end after/);
  });
  it("has a phase", () => {
    const e = { status: "active", starts_at: new Date(now + H).toISOString(), ends_at: new Date(now + 2 * H).toISOString() };
    expect(eventPhase(e, now)).toBe("upcoming");
    expect(eventPhase(e, now + 1.5 * H)).toBe("on");
    expect(eventPhase(e, now + 2 * H)).toBe("ended");
    expect(eventPhase({ ...e, status: "cancelled" }, now + 1.5 * H)).toBe("cancelled");
  });
});

describe("event places", () => {
  it("counts inside, with a margin on the way out", () => {
    expect(insidePlace({ lat: 53.4, lng: -1.5 }, venue, false, false)).toBe(true);
    // ~10 m outside the edge: still inside if already in, not if arriving.
    const edge = { lat: 53.4 + 510 / 111_320, lng: -1.5 };
    expect(insidePlace(edge, venue, true, false)).toBe(true);
    expect(insidePlace(edge, venue, false, false)).toBe(false);
  });
  it("never counts at home", () => {
    expect(insidePlace({ lat: 53.4, lng: -1.5 }, venue, true, true)).toBe(false);
  });
  it("knows when a place includes a point (home)", () => {
    expect(placesInclude([{ geojson: venue }], { lat: 53.4, lng: -1.5 })).toBe(true);
    expect(placesInclude([{ geojson: venue }], { lat: 53.5, lng: -1.5 })).toBe(false);
  });
});

describe("repeating events", () => {
  const thu: Recurrence = { freq: "weekly", days: [4], start_time: "18:00", end_time: "22:00" };

  it("converts UK times, winter and summer", () => {
    expect(new Date(londonToUtc("2026-12-03", "18:00")).toISOString()).toBe("2026-12-03T18:00:00.000Z");
    expect(new Date(londonToUtc("2027-06-03", "18:00")).toISOString()).toBe("2027-06-03T17:00:00.000Z");
  });

  it("spans the first to the last chosen day", () => {
    const w = seriesWindow(thu, "2026-12-01", "2027-01-31")!;
    expect(new Date(w.startsAt).toISOString()).toBe("2026-12-03T18:00:00.000Z");
    expect(new Date(w.endsAt).toISOString()).toBe("2027-01-28T22:00:00.000Z");
    expect(seriesWindow(thu, "2026-12-01", "2026-12-02")).toBeNull();
  });

  it("is on only during its times", () => {
    const w = seriesWindow(thu, "2026-12-01", "2027-06-30")!;
    const e = { status: "active", starts_at: new Date(w.startsAt).toISOString(), ends_at: new Date(w.endsAt).toISOString(), recurrence: thu };
    expect(eventOnAt(e, Date.parse("2026-12-10T19:00:00Z"))).toBe(true); // Thursday 19:00
    expect(eventOnAt(e, Date.parse("2026-12-10T22:00:00Z"))).toBe(false); // ended at 22:00
    expect(eventOnAt(e, Date.parse("2026-12-11T19:00:00Z"))).toBe(false); // Friday
    expect(eventOnAt(e, Date.parse("2027-06-03T17:30:00Z"))).toBe(true); // 18:30 BST
    expect(eventOnAt(e, Date.parse("2027-06-03T21:30:00Z"))).toBe(false); // 22:30 BST
  });

  it("handles times past midnight", () => {
    const fri: Recurrence = { freq: "weekly", days: [5], start_time: "22:00", end_time: "02:00" };
    const w = seriesWindow(fri, "2026-12-01", "2026-12-31")!;
    const e = { starts_at: new Date(w.startsAt).toISOString(), ends_at: new Date(w.endsAt).toISOString(), recurrence: fri };
    expect(eventOnAt(e, Date.parse("2026-12-05T01:00:00Z"))).toBe(true); // Saturday 01:00, from Friday
    expect(eventOnAt(e, Date.parse("2026-12-05T23:00:00Z"))).toBe(false); // Saturday 23:00
    expect(new Date(w.endsAt).toISOString()).toBe("2026-12-26T02:00:00.000Z");
    expect(describeRecurrence(fri)).toBe("Every Friday, 22:00 to 02:00 (next day)");
  });

  it("lists its dates for the calendar", () => {
    const w = seriesWindow(thu, "2026-12-01", "2026-12-31")!;
    const e = { starts_at: new Date(w.startsAt).toISOString(), ends_at: new Date(w.endsAt).toISOString(), recurrence: thu };
    expect(eventDates(e, "2026-12-01", "2026-12-31")).toEqual(["2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31"]);
    const once = { starts_at: "2027-02-05T10:00:00Z", ends_at: "2027-02-07T18:00:00Z" };
    expect(eventDates(once, "2027-02-01", "2027-02-28")).toEqual(["2027-02-05", "2027-02-06", "2027-02-07"]);
  });
});

describe("Outlook-style repeats", () => {
  const t = { start_time: "18:00", end_time: "22:00" };
  const dates = (r: Recurrence, anchor: string, from: string, to: string) => {
    const out: string[] = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      if (isOccurrenceDate(r, k, anchor)) out.push(k);
    }
    return out;
  };

  it("every 3 days", () => {
    expect(dates({ freq: "daily", interval: 3, ...t }, "2026-12-01", "2026-12-01", "2026-12-10")).toEqual(["2026-12-01", "2026-12-04", "2026-12-07", "2026-12-10"]);
  });
  it("every 4 weeks on Thursday", () => {
    expect(dates({ freq: "weekly", interval: 4, days: [4], ...t }, "2026-12-01", "2026-12-01", "2027-02-28")).toEqual(["2026-12-03", "2026-12-31", "2027-01-28", "2027-02-25"]);
  });
  it("every month on the 1st, and the 31st falls back to the month's last day", () => {
    expect(dates({ freq: "monthly", by: "day", day: 1, ...t }, "2026-12-01", "2026-12-01", "2027-03-31")).toEqual(["2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]);
    expect(dates({ freq: "monthly", by: "day", day: 31, ...t }, "2027-01-01", "2027-01-01", "2027-04-30")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });
  it("the first Monday and the last Friday of the month, every 2 months", () => {
    expect(dates({ freq: "monthly", by: "nth", nth: 1, weekday: 1, ...t }, "2026-12-01", "2026-12-01", "2027-02-28")).toEqual(["2026-12-07", "2027-01-04", "2027-02-01"]);
    expect(dates({ freq: "monthly", interval: 2, by: "nth", nth: -1, weekday: 5, ...t }, "2026-12-01", "2026-12-01", "2027-04-30")).toEqual(["2026-12-25", "2027-02-26", "2027-04-30"]);
  });
  it("every year on a date, or the second Saturday of May", () => {
    expect(dates({ freq: "yearly", by: "day", day: 5, month: 12, ...t }, "2026-12-01", "2026-12-01", "2028-12-31")).toEqual(["2026-12-05", "2027-12-05", "2028-12-05"]);
    expect(dates({ freq: "yearly", by: "nth", nth: 2, weekday: 6, month: 5, ...t }, "2027-01-01", "2027-01-01", "2028-12-31")).toEqual(["2027-05-08", "2028-05-13"]);
  });
  it("ends after a number of times, or never", () => {
    const r: Recurrence = { freq: "monthly", by: "day", day: 1, ...t };
    const w = seriesWindow(r, "2026-12-01", { count: 3 })!;
    expect(w.lastDate).toBe("2027-02-01");
    expect(new Date(w.endsAt).toISOString()).toBe("2027-02-01T22:00:00.000Z");
    const open = seriesWindow(r, "2026-12-01", {})!;
    expect(open.lastDate).toBeNull();
    expect(new Date(open.endsAt).toISOString().slice(0, 10)).toBe(OPEN_END_DATE);
  });
  it("is on only during its own days and times", () => {
    const r: Recurrence = { freq: "monthly", by: "nth", nth: 1, weekday: 1, ...t, anchor: "2026-12-01" };
    const w = seriesWindow(r, "2026-12-01", {})!;
    const e = { starts_at: new Date(w.startsAt).toISOString(), ends_at: new Date(w.endsAt).toISOString(), recurrence: r };
    expect(eventOnAt(e, Date.parse("2027-01-04T19:00:00Z"))).toBe(true); // first Monday of January
    expect(eventOnAt(e, Date.parse("2027-01-11T19:00:00Z"))).toBe(false); // second Monday
  });
  it("describes itself", () => {
    expect(describeRecurrence({ freq: "weekly", interval: 4, days: [4], ...t })).toBe("Every 4 weeks on Thursday, 18:00 to 22:00");
    expect(describeRecurrence({ freq: "monthly", by: "day", day: 1, ...t, until: "2027-12-31" }, { end: true })).toBe("Every month on the 1st, 18:00 to 22:00, until 31 December 2027");
    expect(describeRecurrence({ freq: "monthly", by: "nth", nth: -1, weekday: 5, ...t, count: 6 }, { end: true })).toBe("Every month on the last Friday, 18:00 to 22:00, 6 times");
    expect(describeRecurrence({ freq: "yearly", by: "nth", nth: 2, weekday: 6, month: 5, ...t }, { times: false })).toBe("Every year on the second Saturday of May");
  });
});

describe("my public restrictions on maps", () => {
  it("draws my areas always, and my bans only while on (solid) or coming up (dashed), as background", async () => {
    const { restrictionFeatures } = await import("@/components/restrictions");
    const g = { type: "Polygon" as const, coordinates: [circleRing({ lat: 53.4, lng: -1.5 }, 500, 16)] };
    const ev = (phase: "on" | "upcoming" | "ended" | "cancelled") => ({
      reference: phase, title: phase, details: null, level: "demand" as const, starts_at: "", ends_at: "", status: "active" as const,
      includes_home: false, is_owner: true, phase, places: [{ name: "P", kind: "venue" as const, center_lat: 0, center_lng: 0, radius_m: 500, geojson: g }],
    });
    const f = restrictionFeatures({ owner_first: "I", areas: [{ reference: "A", name: "Area", geojson: g }], events: [ev("on"), ev("upcoming"), ev("ended"), ev("cancelled")] });
    expect(f).toHaveLength(3);
    expect(f.every((x) => x.properties.context && x.properties.color === "#C62828")).toBe(true);
    expect(f[1].properties.dashed).toBeFalsy();
    expect(f[2].properties.dashed).toBe(true);
  });
});
