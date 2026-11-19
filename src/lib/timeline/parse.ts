/**
 * Google Timeline export adapters. Pure functions: run in the browser (so large
 * exports never hit the serverless body limit) AND on the server (to re-validate).
 *
 * Supported structures:
 *   - records        Takeout "Records.json"                { locations: [...] }
 *   - semantic       Takeout "Semantic Location History"   { timelineObjects: [...] }
 *   - android_device On-device export (Android, 2024+)      { semanticSegments, rawSignals }
 *   - ios_device     On-device export (iOS)                 [ { startTime, visit|activity|timelinePath } ]
 */

import { isValidLatLng } from "@/lib/geo";

export type TimelineFormat = "records" | "semantic" | "android_device" | "ios_device";

export interface NormalizedObservation {
  sourceRecordId: string;
  observedAt: string; // ISO 8601 UTC
  lat: number;
  lng: number;
  accuracyM: number | null;
  metadata: {
    kind: "raw" | "visit_start" | "visit_end" | "path";
    placeName?: string;
    placeId?: string;
    format: TimelineFormat;
  };
}

export interface RejectedRecord {
  index: number;
  reason: string;
}

export interface ParseResult {
  format: TimelineFormat;
  observations: NormalizedObservation[];
  rejected: RejectedRecord[];
  duplicatesInFile: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}

export class UnsupportedFormatError extends Error {
  constructor() {
    super(
      "Unrecognised file. Supported: Google Takeout Records.json, Semantic Location History monthly JSON, " +
        "and on-device Timeline exports (Android Timeline.json / iOS location-history.json).",
    );
    this.name = "UnsupportedFormatError";
  }
}

const MIN_DATE = Date.UTC(2005, 0, 1);

export function detectFormat(data: unknown): TimelineFormat {
  if (Array.isArray(data)) {
    const first = data.find((x) => x && typeof x === "object") as Record<string, unknown> | undefined;
    if (first && ("startTime" in first || "endTime" in first)) return "ios_device";
    throw new UnsupportedFormatError();
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.locations)) return "records";
    if (Array.isArray(o.timelineObjects)) return "semantic";
    if (Array.isArray(o.semanticSegments) || Array.isArray(o.rawSignals)) return "android_device";
  }
  throw new UnsupportedFormatError();
}

/** "51.5074°, -0.1278°"  |  "geo:51.5074,-0.1278"  |  "51.5074,-0.1278" */
export function parseLatLngString(s: unknown): { lat: number; lng: number } | null {
  if (typeof s !== "string") return null;
  const cleaned = s.replace(/^geo:/i, "").replace(/°/g, "");
  const parts = cleaned.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return { lat: parts[0], lng: parts[1] };
}

function e7(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  let v = n / 1e7;
  // Google documented an overflow bug in some exports: values > 180/90 must wrap.
  if (v > 180) v -= 4294967296 / 1e7;
  return v;
}

function parseTime(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    if (/^\d+$/.test(v)) return Number(v);
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function makeSourceRecordId(epochMs: number, lat: number, lng: number): string {
  return `${epochMs}:${Math.round(lat * 1e7)}:${Math.round(lng * 1e7)}`;
}

class Collector {
  observations: NormalizedObservation[] = [];
  rejected: RejectedRecord[] = [];
  seen = new Set<string>();
  duplicates = 0;
  constructor(
    private format: TimelineFormat,
    private now = Date.now(),
  ) {}

  add(
    index: number,
    lat: number | null,
    lng: number | null,
    time: number | null,
    accuracy: number | null,
    meta: Omit<NormalizedObservation["metadata"], "format">,
  ) {
    if (lat === null || lng === null || !isValidLatLng(lat, lng)) {
      this.rejected.push({ index, reason: "invalid coordinates" });
      return;
    }
    if (time === null) {
      this.rejected.push({ index, reason: "missing or invalid timestamp" });
      return;
    }
    if (time < MIN_DATE || time > this.now + 24 * 3600 * 1000) {
      this.rejected.push({ index, reason: "timestamp out of range" });
      return;
    }
    if (accuracy !== null && (accuracy < 0 || accuracy > 100_000)) accuracy = null;
    const id = makeSourceRecordId(time, lat, lng);
    if (this.seen.has(id)) {
      this.duplicates++;
      return;
    }
    this.seen.add(id);
    this.observations.push({
      sourceRecordId: id,
      observedAt: new Date(time).toISOString(),
      lat,
      lng,
      accuracyM: accuracy,
      metadata: { ...meta, format: this.format },
    });
  }

  result(): ParseResult {
    this.observations.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return {
      format: this.format,
      observations: this.observations,
      rejected: this.rejected,
      duplicatesInFile: this.duplicates,
      firstObservedAt: this.observations[0]?.observedAt ?? null,
      lastObservedAt: this.observations.at(-1)?.observedAt ?? null,
    };
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function parseRecords(data: Obj, c: Collector) {
  arr(data.locations).forEach((raw, i) => {
    const r = obj(raw);
    c.add(
      i,
      e7(r.latitudeE7),
      e7(r.longitudeE7),
      parseTime(r.timestamp ?? r.timestampMs),
      num(r.accuracy),
      { kind: "raw" },
    );
  });
}

function parseSemantic(data: Obj, c: Collector) {
  let i = 0;
  for (const raw of arr(data.timelineObjects)) {
    const t = obj(raw);
    if (t.placeVisit) {
      const pv = obj(t.placeVisit);
      const loc = obj(pv.location);
      const dur = obj(pv.duration);
      const lat = e7(loc.latitudeE7 ?? pv.centerLatE7);
      const lng = e7(loc.longitudeE7 ?? pv.centerLngE7);
      const placeName = typeof loc.name === "string" ? loc.name : undefined;
      const placeId = typeof loc.placeId === "string" ? loc.placeId : undefined;
      c.add(i++, lat, lng, parseTime(dur.startTimestamp ?? dur.startTimestampMs), null, {
        kind: "visit_start",
        placeName,
        placeId,
      });
      c.add(i++, lat, lng, parseTime(dur.endTimestamp ?? dur.endTimestampMs), null, {
        kind: "visit_end",
        placeName,
        placeId,
      });
    } else if (t.activitySegment) {
      const seg = obj(t.activitySegment);
      const rawPath = arr(obj(seg.simplifiedRawPath).points);
      if (rawPath.length) {
        for (const p of rawPath) {
          const pt = obj(p);
          c.add(
            i++,
            e7(pt.latE7),
            e7(pt.lngE7),
            parseTime(pt.timestamp ?? pt.timestampMs),
            num(pt.accuracyMeters),
            { kind: "path" },
          );
        }
      } else {
        const dur = obj(seg.duration);
        const s = obj(seg.startLocation);
        const e = obj(seg.endLocation);
        c.add(i++, e7(s.latitudeE7), e7(s.longitudeE7), parseTime(dur.startTimestamp ?? dur.startTimestampMs), null, {
          kind: "path",
        });
        c.add(i++, e7(e.latitudeE7), e7(e.longitudeE7), parseTime(dur.endTimestamp ?? dur.endTimestampMs), null, {
          kind: "path",
        });
      }
    } else {
      c.rejected.push({ index: i++, reason: "unrecognised timeline object" });
    }
  }
}

function parseAndroid(data: Obj, c: Collector) {
  let i = 0;
  for (const raw of arr(data.semanticSegments)) {
    const s = obj(raw);
    if (s.visit) {
      const cand = obj(obj(s.visit).topCandidate);
      const ll = parseLatLngString(obj(cand.placeLocation).latLng);
      const placeId = typeof cand.placeId === "string" ? cand.placeId : undefined;
      c.add(i++, ll?.lat ?? null, ll?.lng ?? null, parseTime(s.startTime), null, { kind: "visit_start", placeId });
      c.add(i++, ll?.lat ?? null, ll?.lng ?? null, parseTime(s.endTime), null, { kind: "visit_end", placeId });
    }
    for (const p of arr(s.timelinePath)) {
      const pt = obj(p);
      const ll = parseLatLngString(pt.point);
      c.add(i++, ll?.lat ?? null, ll?.lng ?? null, parseTime(pt.time), null, { kind: "path" });
    }
    if (s.activity && !arr(s.timelinePath).length) {
      const a = obj(s.activity);
      const st = parseLatLngString(obj(a.start).latLng);
      const en = parseLatLngString(obj(a.end).latLng);
      c.add(i++, st?.lat ?? null, st?.lng ?? null, parseTime(s.startTime), null, { kind: "path" });
      c.add(i++, en?.lat ?? null, en?.lng ?? null, parseTime(s.endTime), null, { kind: "path" });
    }
  }
  for (const raw of arr(data.rawSignals)) {
    const pos = obj(obj(raw).position);
    if (!Object.keys(pos).length) continue; // wifiScan / activityRecord entries carry no position
    const ll = parseLatLngString(pos.LatLng ?? pos.latLng);
    c.add(i++, ll?.lat ?? null, ll?.lng ?? null, parseTime(pos.timestamp), num(pos.accuracyMeters), {
      kind: "raw",
    });
  }
}

function parseIos(data: unknown[], c: Collector) {
  let i = 0;
  for (const raw of data) {
    const s = obj(raw);
    const start = parseTime(s.startTime);
    if (s.visit) {
      const cand = obj(obj(s.visit).topCandidate);
      const ll = parseLatLngString(cand.placeLocation);
      const placeId = typeof cand.placeID === "string" ? cand.placeID : undefined;
      c.add(i++, ll?.lat ?? null, ll?.lng ?? null, start, null, { kind: "visit_start", placeId });
      c.add(i++, ll?.lat ?? null, ll?.lng ?? null, parseTime(s.endTime), null, { kind: "visit_end", placeId });
    } else if (s.activity) {
      const a = obj(s.activity);
      const st = parseLatLngString(a.start);
      const en = parseLatLngString(a.end);
      c.add(i++, st?.lat ?? null, st?.lng ?? null, start, null, { kind: "path" });
      c.add(i++, en?.lat ?? null, en?.lng ?? null, parseTime(s.endTime), null, { kind: "path" });
    } else if (s.timelinePath) {
      for (const p of arr(s.timelinePath)) {
        const pt = obj(p);
        const ll = parseLatLngString(pt.point);
        const offsetMin = num(pt.durationMinutesOffsetFromStartTime);
        const t = start !== null && offsetMin !== null ? start + offsetMin * 60_000 : null;
        c.add(i++, ll?.lat ?? null, ll?.lng ?? null, t, null, { kind: "path" });
      }
    } else {
      c.rejected.push({ index: i++, reason: "unrecognised segment" });
    }
  }
}

export function parseTimeline(data: unknown, now = Date.now()): ParseResult {
  const format = detectFormat(data);
  const c = new Collector(format, now);
  switch (format) {
    case "records":
      parseRecords(data as Obj, c);
      break;
    case "semantic":
      parseSemantic(data as Obj, c);
      break;
    case "android_device":
      parseAndroid(data as Obj, c);
      break;
    case "ios_device":
      parseIos(data as unknown[], c);
      break;
  }
  return c.result();
}
