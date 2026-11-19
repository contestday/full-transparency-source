// Publication policy: decides whether and how a private record becomes public. Pure.

import { haversineMeters, snapToGrid, type LatLng } from "@/lib/geo";

export interface PublicationRuleRow {
  id?: string;
  rule_type: string;
  configuration: Record<string, unknown>;
  enabled: boolean;
}

export interface Zone extends LatLng {
  radiusM: number;
  label: string;
}

export interface PublicationPolicy {
  paused: boolean;
  delayHours: number;
  gridM: number;
  exclusionZones: Zone[];
  excludedCategories: Set<string>;
  areaLabels: Zone[];
  publishTracks: boolean;
  trackIntervalMinutes: number;
}

const n = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function zone(c: Record<string, unknown>): Zone | null {
  const lat = n(c.lat, NaN);
  const lng = n(c.lng, NaN);
  const radiusM = n(c.radius_m, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusM) || radiusM <= 0) return null;
  return { lat, lng, radiusM, label: typeof c.label === "string" ? c.label : "" };
}

export const MIN_GRID_M = 250;
export const MIN_DELAY_HOURS = 0;

export function buildPolicy(rules: PublicationRuleRow[]): PublicationPolicy {
  const enabled = rules.filter((r) => r.enabled);
  const first = (t: string) => enabled.find((r) => r.rule_type === t);
  const tracks = first("publish_tracks");
  return {
    // Fail safe: an enabled pause rule pauses; a MISSING pause rule also pauses.
    // Only an explicitly disabled pause rule allows publication.
    paused: Boolean(first("pause")) || !rules.some((r) => r.rule_type === "pause"),
    delayHours: Math.max(MIN_DELAY_HOURS, n(first("delay")?.configuration.hours, 24)),
    // Grid 0 = exact positions (owner decision, 18 Nov 2026); otherwise at least MIN_GRID_M.
    gridM: n(first("grid")?.configuration.meters, 1000) === 0 ? 0 : Math.max(MIN_GRID_M, n(first("grid")?.configuration.meters, 1000)),
    exclusionZones: enabled
      .filter((r) => r.rule_type === "exclusion_zone")
      .map((r) => zone(r.configuration))
      .filter((z): z is Zone => z !== null),
    excludedCategories: new Set(
      enabled
        .filter((r) => r.rule_type === "excluded_category")
        .map((r) => String(r.configuration.category ?? ""))
        .filter(Boolean),
    ),
    areaLabels: enabled
      .filter((r) => r.rule_type === "area_label")
      .map((r) => zone(r.configuration))
      .filter((z): z is Zone => z !== null),
    publishTracks: Boolean(tracks),
    trackIntervalMinutes: Math.max(3, n(tracks?.configuration.interval_minutes, 60)),
  };
}

export interface Candidate extends LatLng {
  key: string;
  kind: "visit" | "track";
  visitId?: string | null;
  category?: string | null;
  radiusM?: number;
  observedAt: string;
  observedUntil?: string | null;
  areaLabelHint?: string | null;
  /** Set when the visit matched a venue flagged public: published in full. */
  publicVenue?: (LatLng & { name: string }) | null;
}

export type Decision =
  | { publish: false; reason: "paused" | "no_exclusion_zones" | "delay" | "exclusion_zone" | "category" }
  | {
      publish: true;
      record: {
        source_key: string;
        kind: "visit" | "track";
        source_visit_id: string | null;
        public_lat: number;
        public_lng: number;
        cell_size_m: number;
        venue_name: string | null;
        area_label: string | null;
        category: string | null;
        observed_at: string;
        observed_until: string | null;
      };
    };

/** Round a timestamp down to 15 minutes so public times do not imply false precision. */
export function coarsenTime(iso: string, minutes = 15): string {
  const ms = minutes * 60_000;
  return new Date(Math.floor(Date.parse(iso) / ms) * ms).toISOString();
}

export function decide(c: Candidate, policy: PublicationPolicy, now = Date.now()): Decision {
  if (policy.paused) return { publish: false, reason: "paused" };
  // Safety interlock: never publish anything until at least one exclusion zone
  // (e.g. home) has been configured.
  if (!policy.exclusionZones.length) return { publish: false, reason: "no_exclusion_zones" };
  const endedAt = Date.parse(c.observedUntil ?? c.observedAt);
  if (endedAt + policy.delayHours * 3600_000 > now) return { publish: false, reason: "delay" };
  if (c.category && policy.excludedCategories.has(c.category)) return { publish: false, reason: "category" };

  // Public venue (pub, hotel, ...): shown in full, unless it sits inside an
  // exclusion zone. No cell-overlap rule: an exact venue does not hint at home.
  if (c.publicVenue) {
    const v = c.publicVenue;
    if (policy.exclusionZones.some((z) => haversineMeters(v, z) <= z.radiusM)) return { publish: false, reason: "exclusion_zone" };
    return {
      publish: true,
      record: {
        source_key: c.key,
        kind: c.kind,
        source_visit_id: c.visitId ?? null,
        public_lat: v.lat,
        public_lng: v.lng,
        cell_size_m: 0,
        venue_name: v.name,
        area_label: c.areaLabelHint ?? null,
        category: c.category ?? null,
        observed_at: coarsenTime(c.observedAt, policy.gridM === 0 ? 1 : 15),
        observed_until: c.observedUntil ? coarsenTime(c.observedUntil, policy.gridM === 0 ? 1 : 15) : null,
      },
    };
  }

  // Exact mode: the real position, anywhere outside the exclusion zones.
  if (policy.gridM === 0) {
    for (const z of policy.exclusionZones) {
      if (haversineMeters(c, z) <= z.radiusM + (c.radiusM ?? 0)) return { publish: false, reason: "exclusion_zone" };
    }
    const toMinute = (iso: string) => coarsenTime(iso, 1);
    return {
      publish: true,
      record: {
        source_key: c.key,
        kind: c.kind,
        source_visit_id: c.visitId ?? null,
        public_lat: Math.round(c.lat * 1e6) / 1e6,
        public_lng: Math.round(c.lng * 1e6) / 1e6,
        cell_size_m: 0,
        venue_name: null,
        area_label: policy.areaLabels.find((z) => haversineMeters(c, z) <= z.radiusM)?.label ?? c.areaLabelHint ?? null,
        category: c.category ?? null,
        observed_at: c.kind === "track" ? new Date(Date.parse(c.observedAt)).toISOString() : toMinute(c.observedAt),
        observed_until: c.observedUntil ? toMinute(c.observedUntil) : null,
      },
    };
  }

  const cell = snapToGrid(c, policy.gridM);
  const cellHalfDiag = (policy.gridM * Math.SQRT2) / 2;
  for (const z of policy.exclusionZones) {
    // Exclude if the raw position is in the zone, OR the published cell overlaps
    // it (otherwise the cell containing home could be published).
    if (haversineMeters(c, z) <= z.radiusM + (c.radiusM ?? 0)) return { publish: false, reason: "exclusion_zone" };
    if (haversineMeters(cell, z) <= z.radiusM + cellHalfDiag) return { publish: false, reason: "exclusion_zone" };
  }

  const label = policy.areaLabels.find((z) => haversineMeters(c, z) <= z.radiusM)?.label ?? c.areaLabelHint ?? null;

  return {
    publish: true,
    record: {
      source_key: c.key,
      kind: c.kind,
      source_visit_id: c.visitId ?? null,
      public_lat: cell.lat,
      public_lng: cell.lng,
      cell_size_m: policy.gridM,
      venue_name: null,
      area_label: label,
      category: c.category ?? null,
      // Route samples are already rounded to their sampling interval (e.g. 3 min);
      // rounding them again to 15 min would scramble their order.
      observed_at: c.kind === "track" ? new Date(Date.parse(c.observedAt)).toISOString() : coarsenTime(c.observedAt),
      observed_until: c.observedUntil ? coarsenTime(c.observedUntil) : null,
    },
  };
}
