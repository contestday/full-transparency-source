import { describe, expect, it } from "vitest";
import { publicStopFor } from "@/lib/plans";

describe("private locations", () => {
  it("never name or place a private location, whatever the mode", () => {
    const v = { name: "Somewhere", is_public: true, is_hidden: true, lat: 53, lng: -1.5, public_area_label: "Some area" };
    for (const mode of ["exact_venue", "general_area", "retrospective"] as const) {
      expect(publicStopFor(mode, v)).toEqual({ public_venue_name: null, public_area_label: null, public_lat: null, public_lng: null, public_cell_size_m: null });
    }
  });
});
