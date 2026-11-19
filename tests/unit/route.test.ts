import { describe, expect, it } from "vitest";
import { routeSegments } from "@/lib/route";

const p = (t: string, lat: number, lng: number, until?: string) => ({ observed_at: `2026-11-16T${t}:00Z`, observed_until: until ? `2026-11-16T${until}:00Z` : null, public_lat: lat, public_lng: lng });

describe("routeSegments", () => {
  it("joins points in time order", () => {
    expect(routeSegments([p("10:06", 53.2, -1.2), p("10:00", 53.1, -1.1), p("10:03", 53.15, -1.15)])).toEqual([[[-1.1, 53.1], [-1.15, 53.15], [-1.2, 53.2]]]);
  });
  it("breaks the line across long gaps (e.g. time at home)", () => {
    const segs = routeSegments([p("10:00", 53.1, -1.1), p("10:03", 53.2, -1.2), p("14:00", 53.3, -1.3), p("14:03", 53.4, -1.4)]);
    expect(segs).toHaveLength(2);
  });
  it("measures gaps from the end of a stay, not its start", () => {
    const segs = routeSegments([p("10:00", 53.1, -1.1, "13:58"), p("14:00", 53.2, -1.2)]);
    expect(segs).toHaveLength(1);
  });
  it("drops repeated identical points and single-point segments", () => {
    expect(routeSegments([p("10:00", 53.1, -1.1), p("10:03", 53.1, -1.1)])).toEqual([]);
  });
});
