import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { geofenceSubmissionSchema, normaliseGeofence } from "@/lib/geofence/submission";
import { DEFAULT_SUBMISSION_BOUNDS } from "@/lib/geo";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/ingest", () => ({ getSystemState: async () => null, setSystemState: async () => undefined }));

const home = { lat: 53.38, lng: -1.47 };
const base = { form_started_at: Date.now() - 10_000 };

describe("anywhere beyond home", () => {
  it("is stored as the circle around home, flagged for inverted evaluation", () => {
    const input = geofenceSubmissionSchema.parse({ ...base, shape: { type: "beyond_home", distance_m: 8047 } });
    const g = normaliseGeofence(input.shape, DEFAULT_SUBMISSION_BOUNDS, home);
    expect(g.shapeType).toBe("beyond_home");
    expect(g.radiusM).toBe(8047);
    expect(g.center).toEqual(home);
  });

  it("is refused if home isn't set, or closer than 1 km (it would pinpoint home)", () => {
    const ok = geofenceSubmissionSchema.parse({ ...base, shape: { type: "beyond_home", distance_m: 5000 } });
    expect(() => normaliseGeofence(ok.shape, DEFAULT_SUBMISSION_BOUNDS, null)).toThrow(/isn't available/);
    expect(geofenceSubmissionSchema.safeParse({ ...base, shape: { type: "beyond_home", distance_m: 200 } }).success).toBe(false);
  });

  it("the watcher's view never includes the home circle (geometry withheld)", () => {
    const src = readFileSync("src/lib/watchers.ts", "utf8");
    expect(src).toMatch(/geojson: a\.kind === "beyond_home" \? null : a\.geometry/);
  });
});

describe("contact alert email", async () => {
  const { composeAlert } = await import("@/lib/incident-contacts");
  const entry = { geofenceId: "x", observedAt: "2026-11-18T21:40:00Z", lat: 54.15, lng: -4.48, accuracyM: 6 };

  it("states the facts plainly, including that areas are set anonymously", () => {
    const { subject, text } = composeAlert(
      { id: "x", reference: "G-ABC123", shape_type: "beyond_home", radius_m: 16093, description: null, watcher_id: "w" },
      entry,
      { includePosition: true, baseUrl: "https://example.test" },
    );
    expect(subject).toContain("G-ABC123");
    expect(text).toContain("anywhere more than 10 miles from my home");
    expect(text).toContain("54.15000, -4.48000");
    expect(text).toContain("not court orders or bail conditions");
    expect(text).toContain("sent at my own request");
  });

  it("leaves the position out when that option is off", () => {
    const { text } = composeAlert(
      { id: "x", reference: "G-1", shape_type: "polygon", radius_m: null, description: "Douglas promenade", watcher_id: "w" },
      entry,
      { includePosition: false, baseUrl: "" },
    );
    expect(text).not.toMatch(/54\.15/);
    expect(text).toContain("Douglas promenade");
  });
});

describe("watcher-chosen report contacts", async () => {
  const { composeAlert } = await import("@/lib/incident-contacts");
  const { stopTokenFor } = await import("@/lib/watcher-contacts");
  const entry = { geofenceId: "x", observedAt: "2026-11-18T21:40:00Z", lat: 54.15, lng: -4.48, accuracyM: 6 };

  it("reports to a watcher's contact explain who set it up and carry a stop link", () => {
    const { text } = composeAlert(
      { id: "x", reference: "G-9", shape_type: "beyond_home", radius_m: 8047, description: null, watcher_id: "w" },
      entry,
      { includePosition: false, baseUrl: "", audience: "watcher", stopUrl: "https://example.test/contacts/stop?t=abc" },
    );
    expect(text).toContain("You confirmed you wanted these reports");
    expect(text).toContain("more than 5 miles from their home");
    expect(text).toContain("To stop these emails: https://example.test/contacts/stop?t=abc");
  });

  it("stop tokens are stable per contact and differ between contacts", () => {
    expect(stopTokenFor("a")).toBe(stopTokenFor("a"));
    expect(stopTokenFor("a")).not.toBe(stopTokenFor("b"));
  });

  it("the new table has RLS on and no public access", () => {
    const sql = readFileSync("supabase/migrations/20261118000013_watcher_contacts.sql", "utf8");
    expect(sql).toMatch(/alter table public\.watcher_contacts enable row level security/);
    expect(sql).toMatch(/revoke all on public\.watcher_contacts from anon, authenticated/);
  });
});
