// Live status marker logic. Pure; no I/O.

import { haversineMeters, snapToGrid, type LatLng } from "@/lib/geo";
import type { Zone } from "@/lib/publication";

export type LiveStatus = "green" | "yellow" | "amber" | "red" | "purple" | "black" | "unknown";

export const LIVE_STATUS_META: Record<LiveStatus | "disabled", { label: string; color: string; description: string }> = {
  green: { label: "Within okay zone", color: "#007b60", description: "Inside the okay zone around home." },
  yellow: { label: "Outside okay zone", color: "#D4A900", description: "Outside the okay zone around home." },
  amber: { label: "In a Wish area", color: "#F08C00", description: "Inside a watcher's Wish area: somewhere they'd rather I didn't go." },
  red: { label: "In a Want area", color: "#c62828", description: "Inside a watcher's Want area: somewhere they've asked me not to go." },
  purple: { label: "At a location", color: "#7e22ce", description: "At one of a watcher's locations (shown only to that watcher)." },
  black: { label: "At an event", color: "#111111", description: "At one of a watcher's events, while it's on (shown only to that watcher)." },
  unknown: { label: "No current location", color: "#64748b", description: "No recent GPS update." },
  disabled: { label: "Live status not shown", color: "#64748b", description: "The live marker is switched off." },
};

/** States the public can see, and the states a watcher can see (strongest first). */
export const PUBLIC_STATES = ["green", "yellow", "red", "unknown"] as const;
/** Labels for what everyone sees. */
export const PUBLIC_LABELS: Partial<Record<LiveStatus, string>> = { red: "In one of my noted areas" };
export const WATCH_STATES = ["black", "purple", "red", "amber", "yellow", "green", "unknown"] as const;
export const WATCH_LABELS: Partial<Record<LiveStatus, string>> = {
  black: "At one of your events",
  purple: "At one of your locations",
  red: "In one of your Want areas",
  amber: "In one of your Wish areas",
};

export const DEFAULT_HOME_RADIUS_M = 4828; // 3 miles

/**
 * Overall colour. Wide areas (the only watcher areas the owner can see) make
 * it amber; otherwise green inside the okay zone, yellow outside. Membership
 * uses the hysteresis-confirmed `inside` flags, so GPS jitter cannot flicker it.
 */
export function computeLiveStatus(input: {
  stale: boolean;
  insideFenceIds: ReadonlySet<string>;
  homeInside: boolean | null; // null = home range not configured
  /** Inside one of my own (admin) areas: red for everyone. */
  insideOwn?: boolean;
  /** Inside a watcher's Want area (owner's own view only). */
  insideWant?: boolean;
}): LiveStatus {
  if (input.stale) return "unknown";
  if (input.insideWant) return "red";
  if (input.insideFenceIds.size > 0) return "amber";
  if (input.insideOwn) return "red";
  if (input.homeInside === null) return "unknown";
  return input.homeInside ? "green" : "yellow";
}

/** Signed distance to the home-range boundary: positive inside, negative outside. */
export function homeSignedDistance(p: LatLng, home: LatLng & { radiusM: number }): number {
  return home.radiusM - haversineMeters(p, home);
}

/**
 * Generalised public position for the marker, or null when it must be hidden:
 * unknown (stale), or anywhere whose square touches a hidden zone (e.g. the
 * 250 m around home). Movement inside the okay zone IS shown (green).
 */
export function publicMarkerPosition(
  status: LiveStatus,
  p: LatLng | null,
  gridM: number,
  exclusionZones: readonly Zone[],
): (LatLng & { cellM: number }) | null {
  if (!p || status === "unknown") return null;
  // Safety interlock: never show a position until home is hidden.
  if (!exclusionZones.length) return null;
  const cell = snapToGrid(p, gridM);
  const halfDiag = (gridM * Math.SQRT2) / 2;
  for (const z of exclusionZones) {
    if (haversineMeters(p, z) <= z.radiusM || haversineMeters(cell, z) <= z.radiusM + halfDiag) return null;
  }
  return cell;
}

/**
 * Colour for one watcher: their own areas (purple > red > amber) win;
 * otherwise the okay-zone colour everyone sees (green / yellow).
 */
export function computeWatcherStatus(input: {
  stale: boolean;
  /** The public okay-zone colour. */
  homeStatus: LiveStatus;
  /** Strongest of the watcher's own areas the latest position is in, if any. */
  areaZone: "purple" | "red" | "amber" | null;
  /** At one of the watcher's events while it's on: black, above everything else. */
  atEvent?: boolean;
}): LiveStatus {
  if (input.stale) return "unknown";
  if (input.atEvent) return "black";
  return input.areaZone ?? input.homeStatus;
}

export interface MovementReading {
  observed_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_kmh?: number | null;
}

export const MOVING_RECENT_MS = 10 * 60_000;

/**
 * "On the move" from the latest live readings (newest first). True when the
 * newest reading is recent and either reports walking speed or more, or is
 * clearly displaced from the reading before it (beyond GPS noise) within a
 * short time. FollowMee sends points mostly while moving, so frequent,
 * displaced points are a good signal.
 */
export function isOnTheMove(readings: MovementReading[], now = Date.now()): boolean {
  const [latest, previous] = readings;
  if (!latest || now - Date.parse(latest.observed_at) > MOVING_RECENT_MS) return false;
  if (latest.speed_kmh != null && latest.speed_kmh >= 3) return true;
  if (!previous) return false;
  const gap = Date.parse(latest.observed_at) - Date.parse(previous.observed_at);
  if (gap <= 0 || gap > 15 * 60_000) return false;
  const noise = Math.max(50, (latest.accuracy_m ?? 50) + (previous.accuracy_m ?? 50));
  const dist = haversineMeters(latest, previous);
  return dist > noise && dist / (gap / 1000) > 0.4; // > ~1.4 km/h sustained
}
