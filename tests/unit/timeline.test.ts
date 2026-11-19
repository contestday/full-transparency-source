import { describe, expect, it } from "vitest";
import { detectFormat, parseLatLngString, parseTimeline, UnsupportedFormatError } from "@/lib/timeline/parse";

const NOW = Date.parse("2026-11-17T12:00:00Z");

describe("detectFormat", () => {
  it("recognises each supported structure", () => {
    expect(detectFormat({ locations: [] })).toBe("records");
    expect(detectFormat({ timelineObjects: [] })).toBe("semantic");
    expect(detectFormat({ semanticSegments: [] })).toBe("android_device");
    expect(detectFormat([{ startTime: "2024-01-01T00:00:00Z" }])).toBe("ios_device");
  });
  it("rejects unknown files", () => {
    expect(() => detectFormat({ foo: 1 })).toThrow(UnsupportedFormatError);
    expect(() => detectFormat([1, 2])).toThrow(UnsupportedFormatError);
    expect(() => detectFormat(null)).toThrow(UnsupportedFormatError);
  });
});

describe("parseLatLngString", () => {
  it("parses degree and geo: forms", () => {
    expect(parseLatLngString("51.5074°, -0.1278°")).toEqual({ lat: 51.5074, lng: -0.1278 });
    expect(parseLatLngString("geo:53.4808,-2.2426")).toEqual({ lat: 53.4808, lng: -2.2426 });
    expect(parseLatLngString("nonsense")).toBeNull();
    expect(parseLatLngString(42)).toBeNull();
  });
});

describe("Records.json", () => {
  it("parses, validates, dedupes and preserves timestamps/accuracy", () => {
    const r = parseTimeline(
      {
        locations: [
          { latitudeE7: 515074000, longitudeE7: -1278000, accuracy: 12, timestamp: "2023-05-01T10:00:00.000Z" },
          { latitudeE7: 515074000, longitudeE7: -1278000, accuracy: 12, timestamp: "2023-05-01T10:00:00.000Z" }, // dupe
          { latitudeE7: 515075000, longitudeE7: -1279000, timestampMs: "1682935260000" },
          { latitudeE7: 0, longitudeE7: 0, timestamp: "2023-05-01T10:02:00Z" }, // null island
          { latitudeE7: 515075000, longitudeE7: -1279000 }, // no time
          { latitudeE7: 515075000, longitudeE7: -1279000, timestamp: "2099-01-01T00:00:00Z" }, // future
        ],
      },
      NOW,
    );
    expect(r.format).toBe("records");
    expect(r.observations).toHaveLength(2);
    expect(r.duplicatesInFile).toBe(1);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(["invalid coordinates", "missing or invalid timestamp", "timestamp out of range"]);
    expect(r.observations[0]).toMatchObject({ lat: 51.5074, lng: -0.1278, accuracyM: 12, observedAt: "2023-05-01T10:00:00.000Z" });
    expect(r.observations[1].observedAt).toBe(new Date(1682935260000).toISOString());
  });

  it("handles the documented E7 overflow bug", () => {
    const r = parseTimeline({ locations: [{ latitudeE7: 515074000, longitudeE7: 4294967296 - 1278000, timestamp: "2023-05-01T10:00:00Z" }] }, NOW);
    expect(r.observations[0].lng).toBeCloseTo(-0.1278, 6);
  });

  it("produces identical record IDs on re-import (idempotency)", () => {
    const file = { locations: [{ latitudeE7: 515074000, longitudeE7: -1278000, timestamp: "2023-05-01T10:00:00Z" }] };
    expect(parseTimeline(file, NOW).observations[0].sourceRecordId).toBe(parseTimeline(file, NOW).observations[0].sourceRecordId);
  });
});

describe("Semantic Location History", () => {
  it("emits visit start/end and activity path points", () => {
    const r = parseTimeline(
      {
        timelineObjects: [
          {
            placeVisit: {
              location: { latitudeE7: 534808000, longitudeE7: -22426000, name: "Cafe", placeId: "abc" },
              duration: { startTimestamp: "2023-06-01T09:00:00Z", endTimestamp: "2023-06-01T10:00:00Z" },
            },
          },
          {
            activitySegment: {
              startLocation: { latitudeE7: 534808000, longitudeE7: -22426000 },
              endLocation: { latitudeE7: 534900000, longitudeE7: -22500000 },
              duration: { startTimestamp: "2023-06-01T10:00:00Z", endTimestamp: "2023-06-01T10:20:00Z" },
              simplifiedRawPath: { points: [{ latE7: 534850000, lngE7: -22450000, timestamp: "2023-06-01T10:10:00Z", accuracyMeters: 9 }] },
            },
          },
        ],
      },
      NOW,
    );
    expect(r.observations.map((o) => o.metadata.kind)).toEqual(["visit_start", "visit_end", "path"]);
    expect(r.observations[0].metadata.placeName).toBe("Cafe");
    expect(r.observations[2].accuracyM).toBe(9);
  });
});

describe("Android on-device export", () => {
  it("parses semanticSegments and rawSignals", () => {
    const r = parseTimeline(
      {
        semanticSegments: [
          {
            startTime: "2024-03-01T08:00:00.000+00:00",
            endTime: "2024-03-01T09:00:00.000+00:00",
            visit: { topCandidate: { placeId: "p1", placeLocation: { latLng: "52.4862°, -1.8904°" } } },
          },
          {
            startTime: "2024-03-01T09:00:00.000+00:00",
            endTime: "2024-03-01T10:00:00.000+00:00",
            timelinePath: [{ point: "52.49°, -1.89°", time: "2024-03-01T09:30:00.000+00:00" }],
          },
        ],
        rawSignals: [
          { position: { LatLng: "52.48°, -1.88°", accuracyMeters: 15, timestamp: "2024-03-01T11:00:00.000+00:00" } },
          { wifiScan: {} },
        ],
      },
      NOW,
    );
    expect(r.format).toBe("android_device");
    expect(r.observations).toHaveLength(4);
    expect(r.observations.at(-1)).toMatchObject({ accuracyM: 15, metadata: { kind: "raw" } });
  });
});

describe("iOS on-device export", () => {
  it("parses visits and offset-based timeline paths", () => {
    const r = parseTimeline(
      [
        { startTime: "2024-04-01T08:00:00.000Z", endTime: "2024-04-01T09:00:00.000Z", visit: { topCandidate: { placeLocation: "geo:51.45,-2.58", placeID: "x" } } },
        { startTime: "2024-04-01T09:00:00.000Z", endTime: "2024-04-01T11:00:00.000Z", timelinePath: [{ point: "geo:51.46,-2.59", durationMinutesOffsetFromStartTime: "30" }] },
      ],
      NOW,
    );
    expect(r.format).toBe("ios_device");
    expect(r.observations).toHaveLength(3);
    expect(r.observations[2].observedAt).toBe("2024-04-01T09:30:00.000Z");
  });
});
