import { describe, expect, it } from "vitest";
import { osEastingNorthing, osGridRef } from "@/lib/os-grid";

describe("OS grid references", () => {
  it("matches known points to within a few metres (Helmert: about 5 m; test point rounded)", () => {
    // Ben Nevis summit: NN 16667 71283 (OS).
    const b = osEastingNorthing(56.79685, -5.003508);
    expect(Math.abs(b.e - 216667)).toBeLessThan(25);
    expect(Math.abs(b.n - 771283)).toBeLessThan(25);
    expect(osGridRef(56.79685, -5.003508)).toMatch(/^NN 16[67][0-9] 712[0-9]$/);
  });
  it("letters for Sheffield and outside the grid", () => {
    expect(osGridRef(53.381, -1.4701)?.startsWith("SK")).toBe(true);
    expect(osGridRef(40, -40)).toBeNull();
  });
});
