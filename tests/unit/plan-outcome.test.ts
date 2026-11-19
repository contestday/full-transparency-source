import { describe, expect, it } from "vitest";
import { gpsActualTimes, gpsConfirmsPlan, needsOutcome, planEndMs } from "@/lib/plan-outcome";

const H = 3600_000;
const pub = { lat: 53.3675, lng: -1.53 };
const elsewhere = { lat: 53.4, lng: -1.45 };
const start = Date.parse("2026-11-17T20:00:00Z");
const timed = { starts_at: "2026-11-17T20:00:00Z", ends_at: "2026-11-17T23:00:00Z", all_day: false };

describe("planEndMs", () => {
  it("timed plans end at ends_at, or two hours after the start without one", () => {
    expect(planEndMs(timed)).toBe(start + 3 * H);
    expect(planEndMs({ ...timed, ends_at: null })).toBe(start + 2 * H);
  });
  it("all-day plans run to the end of their last day", () => {
    expect(planEndMs({ starts_at: "2026-11-17T00:00:00Z", ends_at: null, all_day: true })).toBe(Date.parse("2026-11-18T00:00:00Z"));
  });
});

describe("needsOutcome", () => {
  it("only open plans whose time has passed need an answer", () => {
    const after = start + 4 * H;
    expect(needsOutcome({ ...timed, status: "confirmed" }, after)).toBe(true);
    expect(needsOutcome({ ...timed, status: "planned" }, start + H)).toBe(false);
    expect(needsOutcome({ ...timed, status: "completed" }, after)).toBe(false);
    expect(needsOutcome({ ...timed, status: "cancelled" }, after)).toBe(false);
    expect(needsOutcome({ ...timed, status: "draft" }, after)).toBe(false);
  });
});

describe("gpsConfirmsPlan", () => {
  it("a GPS reading at the venue during the plan confirms it", () => {
    expect(gpsConfirmsPlan(timed, [pub], { points: [{ ...pub, t: start + H }], stays: [] })).toBe(true);
  });
  it("a stay inferred from silence (arrived before, left after) confirms it", () => {
    const stays = [{ ...pub, start: start - 10 * 60_000, end: start + 3 * H + 20 * 60_000 }];
    expect(gpsConfirmsPlan(timed, [pub], { points: [], stays })).toBe(true);
  });
  it("being somewhere else, or at the venue on another day, does not", () => {
    expect(gpsConfirmsPlan(timed, [pub], { points: [{ ...elsewhere, t: start + H }], stays: [] })).toBe(false);
    expect(gpsConfirmsPlan(timed, [pub], { points: [{ ...pub, t: start + 24 * H }], stays: [] })).toBe(false);
  });
  it("a plan with no known location can't be confirmed by GPS (you're asked instead)", () => {
    expect(gpsConfirmsPlan(timed, [], { points: [{ ...pub, t: start + H }], stays: [] })).toBe(false);
  });
});

describe("gpsActualTimes", () => {
  it("records when I really arrived and left, not the planned times", () => {
    const stays = [{ ...pub, start: start + 12 * 60_000, end: start + 3 * H + 25 * 60_000 }];
    const t = gpsActualTimes(timed, [pub], { points: [{ ...elsewhere, t: start + H }], stays })!;
    expect(t.start).toBe(start + 12 * 60_000); // 20:12, not 20:00
    expect(t.end).toBe(start + 3 * H + 25 * 60_000); // 23:25, not 23:00
  });
});

describe("planNameForStay", async () => {
  const { planNameForStay } = await import("@/lib/stay-plan-match");
  const { destination } = await import("@/lib/geo");
  const hospital = { lat: 53.38, lng: -1.49 };
  const plan = { starts_at: "2026-11-18T13:00:00Z", ends_at: "2026-11-18T14:30:00Z", all_day: false, point: hospital, name: "Hallamshire Hospital" };
  it("names a stay after the plan when within 800 m during it", () => {
    const stay = { ...destination(hospital, 90, 106), from: "2026-11-18T13:08:00Z", until: "2026-11-18T14:45:00Z" };
    expect(planNameForStay(stay, [plan])).toBe("Hallamshire Hospital");
  });
  it("not when too far, or at another time", () => {
    expect(planNameForStay({ ...destination(hospital, 90, 1200), from: "2026-11-18T13:08:00Z", until: null }, [plan])).toBeNull();
    expect(planNameForStay({ ...hospital, from: "2026-11-18T18:00:00Z", until: "2026-11-18T19:00:00Z" }, [plan])).toBeNull();
  });
});
