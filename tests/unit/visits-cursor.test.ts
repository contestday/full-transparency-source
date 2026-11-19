import { describe, expect, it } from "vitest";
import { detectVisits, fillStationaryGaps, nextVisitsCursor } from "@/lib/visits";

const H = 3600_000;
const M = 60_000;

describe("nextVisitsCursor", () => {
  it("keeps a look-back on live runs instead of jumping to now", () => {
    const now = Date.parse("2026-11-17T22:30:00Z");
    const windowStart = now - 6 * H;
    // No recent visit: next start is 6 h before the window end.
    expect(nextVisitsCursor(windowStart, now, now - 6 * H, now)).toBe(now - 6 * H);
    // Runs 5 minutes apart never collapse the window to a few minutes.
    const next = nextVisitsCursor(now - 5 * M, now, now - 6 * H, now);
    expect(now - next).toBeGreaterThanOrEqual(5 * M);
  });

  it("forces at least an hour of progress only while catching up", () => {
    const now = Date.parse("2026-11-17T22:30:00Z");
    const windowStart = now - 30 * 24 * H;
    const windowEnd = windowStart + 14 * 24 * H;
    // Last visit started at the window start: without the floor this would loop.
    expect(nextVisitsCursor(windowStart, windowEnd, windowStart, now)).toBe(windowStart + H);
  });

  it("a stay seen across successive live runs is detected", () => {
    const start = Date.parse("2026-11-17T21:41:00Z");
    const pts = [
      { lat: 53.3675, lng: -1.53, t: start, accuracyM: 5 },
      { lat: 53.36755, lng: -1.53005, t: start + 39 * M, accuracyM: 13 },
    ];
    expect(detectVisits(pts)).toHaveLength(1);
  });
});

describe("fillStationaryGaps (no upload = still there)", () => {
  const pub = { lat: 53.3675, lng: -1.53 };
  const far = { lat: 53.38, lng: -1.47 };
  const t0 = Date.parse("2026-11-17T21:41:00Z");

  it("a single arrival point followed by silence becomes a stay lasting until now", () => {
    const pts = [{ ...pub, t: t0, accuracyM: 5 }];
    const visits = detectVisits(fillStationaryGaps(pts, t0 + 45 * M));
    expect(visits).toHaveLength(1);
    expect(visits[0].startedAt).toBe(t0);
    expect(visits[0].endedAt).toBe(t0 + 45 * M);
    expect(visits[0].count).toBe(1); // inferred points are not counted as readings
  });

  it("the stay ends just before the next reading elsewhere (when you set off)", () => {
    const pts = [
      { ...pub, t: t0, accuracyM: 5 },
      { ...far, t: t0 + 50 * M, accuracyM: 5 },
    ];
    const visits = detectVisits(fillStationaryGaps(pts, t0 + 51 * M));
    expect(visits).toHaveLength(1);
    expect(visits[0].endedAt).toBe(t0 + 49 * M);
  });

  it("steady movement (readings a minute apart) adds nothing", () => {
    const pts = Array.from({ length: 10 }, (_, k) => ({ lat: 53.36 + k * 0.001, lng: -1.53, t: t0 + k * 70_000, accuracyM: 4 }));
    expect(fillStationaryGaps(pts, pts.at(-1)!.t + 60_000)).toHaveLength(10);
  });

  it("a long silence (a day at home) is still one stay, never a gap", () => {
    const pts = [
      { ...pub, t: t0, accuracyM: 5 },
      { ...far, t: t0 + 20 * H, accuracyM: 5 },
    ];
    const visits = detectVisits(fillStationaryGaps(pts, t0 + 20 * H));
    expect(visits).toHaveLength(1);
    expect(visits[0].endedAt).toBe(t0 + 20 * H - M);
    // And while still silent, it runs to now.
    const ongoing = detectVisits(fillStationaryGaps([pts[0]], t0 + 20 * H));
    expect(ongoing[0].endedAt).toBe(t0 + 20 * H);
  });
});

describe("liveHoldMs", () => {
  it("has no limit by default: silence never turns the status unknown", async () => {
    const { liveHoldMs } = await import("@/lib/env");
    delete process.env.STATIONARY_HOLD_HOURS;
    expect(liveHoldMs()).toBe(Number.POSITIVE_INFINITY);
    expect(Date.now() - Date.parse("2026-01-01T00:00:00Z") > liveHoldMs()).toBe(false);
  });
});
