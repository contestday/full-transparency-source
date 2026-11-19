import { describe, expect, it, vi } from "vitest";
import { buildHistoryUrl, fetchFollowMeeHistory, parseFollowMeeResponse } from "@/lib/followmee";

const NOW = Date.parse("2026-11-17T12:00:00Z");

describe("parseFollowMeeResponse", () => {
  it("parses records, keeps accuracy and the original timestamp (normalised to UTC)", () => {
    const r = parseFollowMeeResponse(
      {
        Data: [
          { DeviceID: "123", Date: "2026-11-17T06:14:03-05:00", Latitude: 51.5, Longitude: -0.12, Accuracy: 8, Type: "GPS", "Speed(km/h)": 0 },
          { DeviceID: "123", Date: "2026-11-17T06:15:03-05:00", Latitude: "51.501", Longitude: "-0.121", Accuracy: "20" },
        ],
      },
      "123",
      NOW,
    );
    expect(r.rejected).toEqual([]);
    expect(r.observations).toHaveLength(2);
    expect(r.observations[0]).toMatchObject({ observedAt: "2026-11-17T11:14:03.000Z", lat: 51.5, accuracyM: 8, sourceRecordId: "123:2026-11-17T11:14:03.000Z" });
    expect(r.observations[1].accuracyM).toBe(20);
  });

  it("rejects bad coordinates, zone-less and future timestamps instead of guessing", () => {
    const r = parseFollowMeeResponse(
      {
        Data: [
          { Date: "2026-11-17T06:14:03-05:00", Latitude: 999, Longitude: 0 },
          { Date: "2026-11-17T06:14:03", Latitude: 51.5, Longitude: -0.12 },
          { Date: "2026-11-18T06:14:03Z", Latitude: 51.5, Longitude: -0.12 },
        ],
      },
      "123",
      NOW,
    );
    expect(r.observations).toHaveLength(0);
    expect(r.rejected).toHaveLength(3);
  });

  it("produces stable IDs so re-polling deduplicates", () => {
    const body = { Data: [{ DeviceID: "1", Date: "2026-11-17T10:00:00Z", Latitude: 51.5, Longitude: -0.1 }] };
    expect(parseFollowMeeResponse(body, "1", NOW).observations[0].sourceRecordId).toBe(parseFollowMeeResponse(body, "1", NOW).observations[0].sourceRecordId);
  });

  it("throws on FollowMee's HTTP-200 error envelope (seen live for a bad device ID)", () => {
    expect(() => parseFollowMeeResponse({ Error: "DeviceID parameter is not valid" }, "1", NOW)).toThrow(/DeviceID parameter is not valid/);
  });

  it("treats an empty response as no data", () => {
    expect(parseFollowMeeResponse({}, "1", NOW).observations).toEqual([]);
  });
});

describe("FollowMee HTTP client", () => {
  it("builds the history URL with clamped hours", () => {
    const u = new URL(buildHistoryUrl({ apiKey: "k", username: "u", deviceId: "d" }, 100));
    expect(u.searchParams.get("function")).toBe("historyfordevice");
    expect(u.searchParams.get("history")).toBe("72");
    expect(new URL(buildHistoryUrl({ apiKey: "k", username: "u", deviceId: "d" }, 0.2)).searchParams.get("history")).toBe("1");
    expect(u.searchParams.get("output")).toBe("json");
  });

  it("surfaces non-JSON error bodies", async () => {
    const fake = vi.fn().mockResolvedValue(new Response("Invalid API key", { status: 200 }));
    await expect(fetchFollowMeeHistory({ apiKey: "k", username: "u", deviceId: "d" }, 1, fake)).rejects.toThrow(/non-JSON/);
  });

  it("surfaces HTTP failures", async () => {
    const fake = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await expect(fetchFollowMeeHistory({ apiKey: "k", username: "u", deviceId: "d" }, 1, fake)).rejects.toThrow(/503/);
  });
});
