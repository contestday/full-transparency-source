import { describe, expect, it } from "vitest";
import { activityInputSchema, resolveActivity } from "@/lib/activities";

const options = [
  { key: "one", label: "Example business" },
  { key: "two", label: "Rejoining an example club" },
];

describe("resolveActivity", () => {
  it("uses the label from the list", () => {
    expect(resolveActivity({ choice: "two" }, options)).toEqual({ key: "two", label: "Rejoining an example club" });
  });
  it("takes free text for Something else", () => {
    expect(resolveActivity({ choice: "other", other: "  Driving a lorry " }, options)).toEqual({ key: null, label: "Driving a lorry" });
  });
  it("needs the free text written", () => {
    expect(resolveActivity({ choice: "other", other: " " }, options)).toEqual({ error: "Write the activity." });
  });
  it("rejects a choice not in the list", () => {
    expect("error" in resolveActivity({ choice: "made-up" }, options)).toBe(true);
  });
  it("limits free text to 120 characters", () => {
    expect(activityInputSchema.safeParse({ choice: "other", other: "x".repeat(121) }).success).toBe(false);
  });
});
