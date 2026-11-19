import { describe, expect, it, vi } from "vitest";
import { classifyQuery, enclosingCircle, fromNominatim, geocode } from "@/lib/geocode";
import { haversineMeters } from "@/lib/geo";

describe("classifyQuery", () => {
  it("recognises UK postcodes and outward codes", () => {
    expect(classifyQuery("SW1A 1AA")).toBe("postcode");
    expect(classifyQuery("sw1a1aa")).toBe("postcode");
    expect(classifyQuery("SW1A 1AA")).toBe("postcode");
    expect(classifyQuery("S11")).toBe("outcode");
    expect(classifyQuery("The Crown, Anytown")).toBe("text");
    expect(classifyQuery("Test Island")).toBe("text");
  });
});

describe("enclosingCircle", () => {
  // Rough Test Island outline (lng, lat)
  const island = {
    type: "Polygon",
    coordinates: [[[-4.79, 54.06], [-4.31, 54.24], [-4.38, 54.42], [-4.6, 54.4], [-4.83, 54.08], [-4.79, 54.06]]],
  };

  it("centres on the middle of the area and reaches its furthest point", () => {
    const c = enclosingCircle(island)!;
    expect(c.center.lat).toBeCloseTo(54.24, 2);
    expect(c.center.lng).toBeCloseTo(-4.57, 2);
    // every vertex is inside or on the circle, and one is on it
    const dists = island.coordinates[0].map(([lng, lat]) => haversineMeters(c.center, { lat, lng }));
    expect(Math.max(...dists)).toBeLessThanOrEqual(c.radiusM);
    expect(c.radiusM - Math.max(...dists)).toBeLessThan(2);
    expect(c.radiusM).toBeGreaterThan(18_000);
    expect(c.radiusM).toBeLessThan(30_000);
  });

  it("handles MultiPolygons and falls back to the bounding box", () => {
    const multi = { type: "MultiPolygon", coordinates: [island.coordinates, [[[-4.9, 54.05], [-4.88, 54.05], [-4.89, 54.04], [-4.9, 54.05]]]] };
    expect(enclosingCircle(multi)!.center.lng).toBeLessThan(-4.6);
    expect(enclosingCircle(null, { minLat: 54, maxLat: 54.4, minLng: -4.8, maxLng: -4.3 })!.center).toEqual({ lat: 54.2, lng: -4.55 });
    expect(enclosingCircle(null)).toBeNull();
  });
});

describe("fromNominatim", () => {
  it("turns a large boundary into an area with an enclosing radius", () => {
    const r = fromNominatim({
      lat: "54.2", lon: "-4.5", display_name: "Test Island", class: "boundary", type: "administrative",
      boundingbox: ["54.04", "54.42", "-4.83", "-4.31"],
      geojson: { type: "Polygon", coordinates: [[[-4.79, 54.06], [-4.31, 54.24], [-4.38, 54.42], [-4.83, 54.08], [-4.79, 54.06]]] },
    });
    expect(r.kind).toBe("area");
    expect(r.enclosingRadiusM).toBeGreaterThan(15_000);
  });

  it("treats a pub (point) as an address with no radius", () => {
    const r = fromNominatim({ lat: "53.38", lon: "-1.47", display_name: "The Crown, Main Road, Anytown", name: "The Crown", class: "amenity", type: "pub", geojson: { type: "Point", coordinates: [-1.47, 53.38] } });
    expect(r).toMatchObject({ kind: "address", name: "The Crown", enclosingRadiusM: null, lat: 53.38 });
  });

  it("treats a small building polygon as a point", () => {
    const r = fromNominatim({ lat: "53.38", lon: "-1.47", display_name: "Somewhere", class: "building", geojson: { type: "Polygon", coordinates: [[[-1.4701, 53.38], [-1.4699, 53.38], [-1.47, 53.3801], [-1.4701, 53.38]]] } });
    expect(r.kind).toBe("address");
    expect(r.enclosingRadiusM).toBeNull();
  });
});

describe("geocode", () => {
  it("uses postcodes.io for UK postcodes", async () => {
    const fake = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { postcode: "SW1A 1AA", latitude: 51.501, longitude: -0.142, admin_district: "Westminster", admin_ward: "St James's" } })));
    const r = await geocode("sw1a 1aa", fake);
    expect(String(fake.mock.calls[0][0])).toContain("api.postcodes.io/postcodes/sw1a1aa");
    expect(r[0]).toMatchObject({ kind: "postcode", lat: 51.501, label: "SW1A 1AA (St James's, Westminster)" });
  });

  it("uses Nominatim (UK + crown dependencies) for text, with an identifying user agent", async () => {
    const fake = vi.fn().mockResolvedValue(new Response("[]"));
    await geocode("Test Island", fake);
    const [url, init] = fake.mock.calls[0];
    expect(String(url)).toContain("nominatim.openstreetmap.org/search");
    expect(String(url)).toContain("countrycodes=gb%2Cim%2Cje%2Cgg");
    expect(init.headers["user-agent"]).toMatch(/FullTransparency/);
  });
});
