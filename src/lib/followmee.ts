/**
 * FollowMee tracks API client.
 *
 * Endpoint shape implemented (per FollowMee's published API documentation — VERIFY
 * against your account's API page before go-live, see docs/FOLLOWMEE.md):
 *
 *   GET https://www.followmee.com/api/tracks.aspx
 *       ?key=<API key>&username=<FollowMee username>&output=json
 *       &function=historyfordevice&deviceid=<id>&history=<hours>
 *
 * Response: { "Data": [ { "DeviceID", "Date", "Latitude", "Longitude", "Accuracy", "Type", ... } ] }
 *
 * The parser is deliberately tolerant of field-name casing and string/number
 * values, and rejects (never "fixes") records with invalid coordinates or times.
 */

import { isValidLatLng } from "@/lib/geo";
import { z } from "zod";

export const FOLLOWMEE_BASE_URL = "https://www.followmee.com/api/tracks.aspx";

/**
 * Largest `history` window requested. FollowMee Basic Service keeps 3 days, and
 * history=72 was accepted live (17 Nov 2026). Gaps longer than this cannot be
 * recovered from the API; import a FollowMee report or Timeline export instead.
 */
export const FOLLOWMEE_MAX_HISTORY_HOURS = 72;

export interface FollowMeeConfig {
  apiKey: string;
  username: string;
  deviceId: string;
  baseUrl?: string;
}

export interface FollowMeeObservation {
  sourceRecordId: string;
  deviceId: string;
  observedAt: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  metadata: Record<string, unknown>;
}

export interface FollowMeeParseResult {
  observations: FollowMeeObservation[];
  rejected: { index: number; reason: string }[];
}

const recordSchema = z.record(z.string(), z.unknown());
const responseSchema = z.object({ Data: z.array(recordSchema).optional() }).passthrough();

function pick(r: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in r) return r[k];
    const found = Object.keys(r).find((rk) => rk.toLowerCase() === k.toLowerCase());
    if (found) return r[found];
  }
  return undefined;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseFollowMeeResponse(
  body: unknown,
  fallbackDeviceId: string,
  now = Date.now(),
): FollowMeeParseResult {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Unexpected FollowMee response shape");
  }
  // FollowMee reports errors as HTTP 200 + { "Error": "..." } (e.g. invalid
  // device ID). Surface them so the poll is marked failed and alerts fire.
  const apiError = (parsed.data as Record<string, unknown>).Error;
  if (typeof apiError === "string" && apiError) {
    throw new Error(`FollowMee API error: ${apiError}`);
  }
  const rows = parsed.data.Data ?? [];
  const observations: FollowMeeObservation[] = [];
  const rejected: { index: number; reason: string }[] = [];

  rows.forEach((r, index) => {
    const lat = toNum(pick(r, "Latitude", "lat"));
    const lng = toNum(pick(r, "Longitude", "lng", "lon"));
    const dateRaw = pick(r, "Date", "Time", "Timestamp");
    // Date includes a UTC offset (e.g. 2026-11-17T09:14:03-05:00). A string without
    // an offset is ambiguous and is rejected rather than guessed.
    const hasOffset = typeof dateRaw === "string" && /([+-]\d{2}:?\d{2}|Z)$/.test(dateRaw.trim());
    const t = typeof dateRaw === "string" ? Date.parse(dateRaw) : NaN;
    if (lat === null || lng === null || !isValidLatLng(lat, lng)) {
      rejected.push({ index, reason: "invalid coordinates" });
      return;
    }
    if (!hasOffset || Number.isNaN(t)) {
      rejected.push({ index, reason: "missing, invalid or zone-less timestamp" });
      return;
    }
    if (t > now + 10 * 60_000) {
      rejected.push({ index, reason: "timestamp in the future" });
      return;
    }
    const deviceId = String(pick(r, "DeviceID", "DeviceId") ?? fallbackDeviceId);
    const accuracy = toNum(pick(r, "Accuracy"));
    const iso = new Date(t).toISOString();
    observations.push({
      sourceRecordId: `${deviceId}:${iso}`,
      deviceId,
      observedAt: iso,
      lat,
      lng,
      accuracyM: accuracy !== null && accuracy >= 0 ? accuracy : null,
      metadata: {
        type: pick(r, "Type") ?? null,
        speed_kmh: toNum(pick(r, "Speed(km/h)")),
        direction: toNum(pick(r, "Direction")),
        altitude_m: toNum(pick(r, "Altitude(m)")),
        battery: pick(r, "Battery") ?? null,
      },
    });
  });

  observations.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  return { observations, rejected };
}

export function buildHistoryUrl(cfg: FollowMeeConfig, hours: number): string {
  const url = new URL(cfg.baseUrl ?? FOLLOWMEE_BASE_URL);
  url.searchParams.set("key", cfg.apiKey);
  url.searchParams.set("username", cfg.username);
  url.searchParams.set("output", "json");
  url.searchParams.set("function", "historyfordevice");
  url.searchParams.set("deviceid", cfg.deviceId);
  url.searchParams.set("history", String(Math.max(1, Math.min(FOLLOWMEE_MAX_HISTORY_HOURS, Math.ceil(hours)))));
  return url.toString();
}

export async function fetchFollowMeeHistory(
  cfg: FollowMeeConfig,
  hours: number,
  fetchImpl: typeof fetch = fetch,
): Promise<FollowMeeParseResult> {
  const res = await fetchImpl(buildHistoryUrl(cfg, hours), {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`FollowMee request failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // FollowMee returns plain-text errors (e.g. invalid key, rate limit).
    throw new Error(`FollowMee returned a non-JSON response: ${text.slice(0, 200)}`);
  }
  return parseFollowMeeResponse(body, cfg.deviceId);
}
