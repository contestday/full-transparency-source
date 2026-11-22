import { describe, expect, it } from "vitest";
import { planReportText } from "@/lib/plan-police";

const facts = { title: "Concert", category: "Social", when: "Sat 5 Dec, 19:00", where: "The Arena", stops: ["Private location"], status: "Planned", description: null, link: "https://example.test/plans" };

describe("plan police report", () => {
  it("puts the plan's facts first, then the reporter's own words", () => {
    const t = planReportText(facts, { concern: "  I think this breaks a court order.  " });
    expect(t.indexOf("Plan: Concert")).toBeLessThan(t.indexOf("MY CONCERN"));
    expect(t).toContain("Stop 2: Private location");
    expect(t).toContain("I think this breaks a court order.\n");
    expect(t).toContain("Name: not given");
  });
  it("adds no allegation of its own", () => {
    const t = planReportText(facts, { concern: "x".repeat(20), name: "A", contact: "a@b.c" });
    expect(t).not.toMatch(/murder|crime|offence|sentence|arrest/i);
    expect(t).toContain("Name: A");
  });
});
